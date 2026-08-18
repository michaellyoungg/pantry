#!/usr/bin/env bash
# Install the pinned Maestro CLI (BL-0072).
#
#   pnpm maestro:install
#
# The vendor's one-liner is `curl -Ls https://get.maestro.mobile.dev | bash`,
# which takes whatever is latest and verifies nothing. Both halves are wrong for
# a test harness: a CLI that floats means two machines disagree about whether
# the app is broken, and the disagreement presents as flake rather than as a
# version difference. Bluesky pins theirs for the same reason.
#
# Upgrading is a deliberate two-line change:
#   1. bump MAESTRO_VERSION
#   2. replace MAESTRO_SHA256 with the value from that release's
#      checksums_sha256.txt, which Maestro publishes as a release asset:
#      https://github.com/mobile-dev-inc/Maestro/releases/download/cli-<v>/checksums_sha256.txt
#
# Env knobs:
#   MAESTRO_HOME=~/.maestro   where to install (matches the vendor's default)
#   MAESTRO_VERSION           override the pin (skips the checksum, and says so)
set -euo pipefail

MAESTRO_VERSION_PINNED="2.8.0"
MAESTRO_SHA256="b3e561161904fb391875ca5834d5b22cf0b01c052dd1b408ad83e30d8f8951b3"

MAESTRO_VERSION="${MAESTRO_VERSION:-$MAESTRO_VERSION_PINNED}"
MAESTRO_HOME="${MAESTRO_HOME:-$HOME/.maestro}"
STAMP="$MAESTRO_HOME/.pantry-version"

die() {
  echo "error: $*" >&2
  exit 1
}

# Maestro 2.x runs on Java 17+. It does check for itself, but only after the
# download, and its message does not mention that this repo pins nothing about
# your JDK — so fail early and say what to do.
require_java() {
  command -v java >/dev/null 2>&1 || die "java not found; Maestro 2.x needs a JDK 17 or newer"

  local version major
  version="$(java -version 2>&1 | sed -n '1s/.*version "\([0-9.]*\).*/\1/p')"
  major="${version%%.*}"
  # Java 8 and earlier report "1.8.0_xxx", where the major version is the second
  # component. Anything from 9 on reports it first.
  [ "$major" = "1" ] && major="$(printf '%s' "$version" | cut -d. -f2)"

  [ -n "$major" ] || die "could not parse a Java version out of: $version"
  [ "$major" -ge 17 ] || die "Java $version found; Maestro 2.x needs 17 or newer"
}

if [ "$MAESTRO_VERSION" != "$MAESTRO_VERSION_PINNED" ]; then
  echo "==> MAESTRO_VERSION=$MAESTRO_VERSION overrides the pin ($MAESTRO_VERSION_PINNED)"
  echo "    the checksum belongs to the pinned version, so it is NOT verified"
  MAESTRO_SHA256=""
fi

if [ -x "$MAESTRO_HOME/bin/maestro" ] && [ "$(cat "$STAMP" 2>/dev/null)" = "$MAESTRO_VERSION" ]; then
  echo "==> maestro $MAESTRO_VERSION already installed at $MAESTRO_HOME"
  exit 0
fi

require_java

URL="https://github.com/mobile-dev-inc/Maestro/releases/download/cli-${MAESTRO_VERSION}/maestro.zip"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "==> downloading maestro $MAESTRO_VERSION (~300MB)"
curl -fsSL --retry 3 -o "$WORK/maestro.zip" "$URL" ||
  die "download failed — is cli-$MAESTRO_VERSION a real release?"

if [ -n "$MAESTRO_SHA256" ]; then
  echo "==> verifying checksum"
  ACTUAL="$(sha256sum "$WORK/maestro.zip" | cut -d' ' -f1)"
  [ "$ACTUAL" = "$MAESTRO_SHA256" ] || die "checksum mismatch
  expected $MAESTRO_SHA256
  got      $ACTUAL"
fi

# Replace rather than merge: a half-overwritten install mixes jars from two
# versions, and the resulting NoSuchMethodError names neither of them.
echo "==> installing to $MAESTRO_HOME"
unzip -q "$WORK/maestro.zip" -d "$WORK/unpacked"
rm -rf "$MAESTRO_HOME"
mkdir -p "$(dirname "$MAESTRO_HOME")"
mv "$WORK/unpacked/maestro" "$MAESTRO_HOME"
chmod +x "$MAESTRO_HOME/bin/maestro"
printf '%s\n' "$MAESTRO_VERSION" >"$STAMP"

echo "==> $("$MAESTRO_HOME/bin/maestro" --version 2>/dev/null | tail -n1) installed"
echo "    add it to PATH:  export PATH=\"$MAESTRO_HOME/bin:\$PATH\""
