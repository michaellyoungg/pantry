#!/usr/bin/env bash
# Run the Maestro end-to-end flows on a simulator or emulator (BL-0072).
#
#   pnpm test:e2e:mobile --platform android
#   pnpm test:e2e:mobile --platform ios
#
# The device counterpart of `pnpm test:e2e`. Same backend, same stack script,
# same per-run account — a different client driving it. What this adds over the
# browser runner is the two things a native client needs: a real debug build
# installed on a real device image, and a Convex URL that device can actually
# reach.
#
# It is NOT part of any PR gate. A native build plus a booted device image is
# minutes of wall clock and gigabytes of toolchain; per the research in
# docs/mobile-testing-strategy.md that belongs in a nightly job, and
# .github/workflows/nightly-mobile-e2e.yml is it (BL-0073) — the same command,
# on a runner that has a device. Run it locally before touching a screen the
# flows drive.
#
# Requirements (see docs/mobile-e2e.md for the full list):
#   - Docker + Docker Compose, Go, pnpm, a JDK 17+.
#   - Maestro:  pnpm maestro:install
#   - android: Android SDK + a *booted* emulator (`maestro start-device
#     --platform android`), and a machine that can run one (KVM on Linux).
#   - ios: macOS with Xcode and a *booted* simulator. There is no way to run
#     this platform anywhere else.
#
# Env knobs:
#   MOBILE_E2E_PLATFORM=android|ios   same as --platform
#   MOBILE_E2E_SKIP_BUILD=1           reuse the build already on the device
#   MOBILE_E2E_METRO_PORT=8081        move Metro off a squatted port
#   MAESTRO_BIN=/path/to/maestro      use a specific CLI
#   E2E_KEEP_STACK=1                  leave the compose stack up afterwards
#
# Extra args after `--` are forwarded to `maestro test`
# (e.g. `pnpm test:e2e:mobile -- --include-tags smoke`).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# shellcheck source=lib/e2e-stack.sh
. "$ROOT/scripts/lib/e2e-stack.sh"

MOBILE_DIR="$ROOT/apps/mobile"
RESULTS_DIR="$MOBILE_DIR/e2e-results"
METRO_PORT="${MOBILE_E2E_METRO_PORT:-8081}"

# The browser suite's SITE_URL is the Vite origin, because Convex Auth needs the
# two to agree for its redirect flows. The native client has no origin, and
# password auth validates against CONVEX_SITE_URL (see
# packages/convex/convex/auth.config.ts) rather than this — so it is set only to
# leave the deployment configured the same way either runner leaves it.
SITE_URL="http://localhost:5173"

usage() {
  sed -n '2,/^set -euo/p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//;$d'
  exit "${1:-0}"
}

PLATFORM="${MOBILE_E2E_PLATFORM:-}"
MAESTRO_ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    -p | --platform)
      PLATFORM="${2:-}"
      shift 2
      ;;
    -h | --help) usage 0 ;;
    --)
      shift
      MAESTRO_ARGS=("$@")
      break
      ;;
    *) e2e_die "unrecognised argument: $1 (see --help)" ;;
  esac
done

if [ -z "$PLATFORM" ]; then
  # Defaulting by host is the friendly choice on a Mac, where both are possible
  # and iOS is the faster loop. Everywhere else there is only one answer.
  [ "$(uname -s)" = "Darwin" ] && PLATFORM="ios" || PLATFORM="android"
  echo "==> no --platform given, defaulting to $PLATFORM on $(uname -s)"
fi

case "$PLATFORM" in
  android)
    # 10.0.2.2 is the emulator's alias for the *host's* loopback. 127.0.0.1
    # inside the emulator is the emulator, so the app would connect to nothing
    # and the failure would present as sign-up hanging. This is the single most
    # likely thing to break when someone moves the stack, so it is one line with
    # its reason attached rather than a platform branch inside a flow.
    #
    # A Genymotion image or a physical device needs a different answer —
    # 10.0.3.2 and `adb reverse tcp:3210 tcp:3210` respectively. See
    # docs/mobile-e2e.md.
    CONVEX_URL="http://10.0.2.2:3210"
    ;;
  ios)
    # The iOS simulator shares the host's network stack outright.
    CONVEX_URL="http://127.0.0.1:3210"
    [ "$(uname -s)" = "Darwin" ] || e2e_die "the iOS simulator only exists on macOS"
    ;;
  *) e2e_die "unknown platform '$PLATFORM' (expected android or ios)" ;;
esac

# --- maestro ---------------------------------------------------------------
MAESTRO="${MAESTRO_BIN:-}"
if [ -z "$MAESTRO" ]; then
  if command -v maestro >/dev/null 2>&1; then
    MAESTRO="$(command -v maestro)"
  elif [ -x "$HOME/.maestro/bin/maestro" ]; then
    MAESTRO="$HOME/.maestro/bin/maestro"
  else
    e2e_die "maestro not found — run 'pnpm maestro:install'"
  fi
fi

# --- a booted device -------------------------------------------------------
# Checked before anything expensive. Discovering there is no emulator after a
# compose up and a Gradle build is a ten-minute answer to a one-second question.
if [ "$PLATFORM" = "android" ]; then
  ADB="${ADB:-$(command -v adb || echo "${ANDROID_HOME:-$HOME/Android/Sdk}/platform-tools/adb")}"
  [ -x "$ADB" ] || e2e_die "adb not found — install the Android SDK platform-tools"
  "$ADB" devices | awk 'NR>1 && $2=="device"' | grep -q . ||
    e2e_die "no booted Android emulator — start one with: maestro start-device --platform android"
else
  xcrun simctl list devices booted | grep -q "Booted" ||
    e2e_die "no booted iOS simulator — start one with: maestro start-device --platform ios"
fi

# --- the backend -----------------------------------------------------------
METRO_PID=""
teardown() {
  [ -n "$METRO_PID" ] && kill "$METRO_PID" 2>/dev/null || true
  e2e_stack_teardown
}
trap teardown EXIT

e2e_stack_up "$SITE_URL"

# --- Metro -----------------------------------------------------------------
# A debug build loads its JS from Metro at launch, so the bundler has to be up
# *and* carrying the run's environment: EXPO_PUBLIC_CONVEX_URL is baked into the
# bundle it serves, not read by the app at runtime. Starting it here rather than
# letting `expo run:*` do it is what makes that possible — and keeps the build
# step from holding the terminal.
mkdir -p "$RESULTS_DIR"
echo "==> starting Metro on :$METRO_PORT (PANTRY_E2E=1, convex $CONVEX_URL)"
(
  cd "$MOBILE_DIR"
  PANTRY_E2E=1 EXPO_PUBLIC_CONVEX_URL="$CONVEX_URL" \
    pnpm exec expo start --port "$METRO_PORT"
) >"$RESULTS_DIR/metro.log" 2>&1 &
METRO_PID=$!

for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:$METRO_PORT/status" 2>/dev/null | grep -q packager-status:running; then
    break
  fi
  kill -0 "$METRO_PID" 2>/dev/null || e2e_die "Metro exited — see $RESULTS_DIR/metro.log"
  sleep 2
done
curl -fsS "http://127.0.0.1:$METRO_PORT/status" 2>/dev/null | grep -q packager-status:running ||
  e2e_die "Metro did not start — see $RESULTS_DIR/metro.log"

# --- the app ---------------------------------------------------------------
# `expo run:*` runs `expo prebuild` first when there is no native project, which
# is the normal state here: apps/mobile/{android,ios} are generated and
# gitignored. The first run therefore takes several minutes; later ones do not.
if [ "${MOBILE_E2E_SKIP_BUILD:-0}" = "1" ]; then
  echo "==> MOBILE_E2E_SKIP_BUILD=1 — using the build already on the device"
else
  echo "==> building and installing the app ($PLATFORM)"
  (
    cd "$MOBILE_DIR"
    PANTRY_E2E=1 EXPO_PUBLIC_CONVEX_URL="$CONVEX_URL" \
      pnpm exec expo "run:$PLATFORM" --no-bundler --port "$METRO_PORT"
  )
fi

# --- the flows -------------------------------------------------------------
# A per-run account, the same isolation the browser suite gets from `signUp()`:
# nothing a flow writes is visible to another flow or to a Playwright spec
# sharing the deployment. Minted here rather than in the flow because Maestro's
# scripting has no clock worth trusting for uniqueness.
RUN_ID="$(date +%s)-${RANDOM}"
E2E_EMAIL="e2e-$RUN_ID@example.test"
# A second account, for the flow that signs out and proves the next one sees
# none of the first one's data. Minted here rather than derived inside the flow
# for the same reason as the first: Maestro's scripting has no clock worth
# trusting, and two accounts that collide make an isolation test pass by being
# the same user.
E2E_EMAIL_2="e2e-$RUN_ID-b@example.test"
E2E_PASSWORD="e2e-password-1234"

echo "==> running Maestro flows as $E2E_EMAIL"
"$MAESTRO" test \
  --platform "$PLATFORM" \
  -e E2E_EMAIL="$E2E_EMAIL" \
  -e E2E_EMAIL_2="$E2E_EMAIL_2" \
  -e E2E_PASSWORD="$E2E_PASSWORD" \
  --format JUNIT \
  --output "$RESULTS_DIR/junit.xml" \
  --test-output-dir "$RESULTS_DIR" \
  --flatten-debug-output \
  "${MAESTRO_ARGS[@]}" \
  "$MOBILE_DIR/e2e"

echo "==> mobile e2e passed (artifacts in $RESULTS_DIR)"
