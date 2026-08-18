# Mobile e2e — the Maestro harness

Status: in force for the harness and one flow ([BL-0072]). Growing the flow set
and running it nightly is [BL-0073].

Playwright cannot drive a native app, so the native client shipped five screens
with no end-to-end coverage at all. This is the loop that closes that:

```bash
pnpm maestro:install                        # once — pinned, checksum-verified
pnpm test:e2e:mobile --platform android     # or --platform ios, on macOS
```

The tool choice and its reasoning are in
[`mobile-testing-strategy.md`](mobile-testing-strategy.md); this document is the
harness itself — what it needs, what it does, and where it will break first.

## What is here

```
apps/mobile/e2e/
  config.yaml               Maestro workspace: which files are flows
  flows/sign-in.yml         the one flow
  subflows/                 fragments BL-0073's flows will reuse
scripts/install-maestro.sh  pinned CLI installer
scripts/mobile-e2e.sh       the runner
scripts/lib/e2e-stack.sh    the backend, shared with the browser suite
```

Plus two guards that run in the normal PR gate, because nothing else does:

- `apps/mobile/src/testing/maestroFlows.test.ts` parses the flows and refuses a
  selector, a `runFlow` target, or a `${VAR}` that does not exist.
- `apps/mobile/src/testing/e2eSelectors.test.tsx` renders the screens the flow
  drives and refuses a declared selector the app no longer emits.

Between them, renaming a `testID` breaks a pull request rather than a nightly
run six hours later.

## Can this run in CI? Not yet, and not here

Being precise about it, because a job that cannot really execute is worse than
no job:

| | |
| --- | --- |
| **iOS** | macOS with Xcode. Nothing else, ever — Apple does not license the simulator elsewhere. |
| **Android** | Android SDK, a system image, and hardware acceleration (KVM on Linux). A plain `ubuntu-latest` runner has no KVM. |
| **Both** | A native debug build. First run includes `expo prebuild` and a full Gradle/Xcode build: minutes, and gigabytes of toolchain. |

None of that fits the per-PR gate, which is the same conclusion Bluesky reached
— their `nightly-e2e.yml` uses `macos-26-xlarge` with a 120-minute timeout. So
`pnpm test:e2e:mobile` is a **local and nightly** command, and there is
deliberately no workflow file for it in this change. Wiring the nightly job,
with artifact upload and a triage owner, is [BL-0073].

### What has and has not been verified

Verified against Maestro 2.8.0:

- the published archive's SHA-256 matches the checksum pinned in
  `scripts/install-maestro.sh`;
- every flow and subflow passes `maestro check-syntax`;
- `maestro test apps/mobile/e2e` discovers the workspace, selects exactly the
  one flow, resolves its `runFlow` targets, and gets as far as launching
  `com.pantry.app`.

Not verified, because this development machine is Linux/WSL2 with no KVM, no
Android SDK and no macOS: **the flow has not been executed on a device.** The
first person with a simulator should expect to fix something, and the two most
likely candidates are named under "where this will break first" below.

## How the runner fits together

`scripts/mobile-e2e.sh`, in order:

1. **Preflight.** Maestro, and a *booted* device. Both are checked before
   anything slow, because finding out after a compose-up and a Gradle build is a
   ten-minute answer to a one-second question.
2. **The backend**, via `scripts/lib/e2e-stack.sh` — the same function
   `pnpm test:e2e` calls. Compose stack, seeded catalog, admin key, deployment
   env, Convex functions pushed.
3. **Metro**, in the background, carrying `EXPO_PUBLIC_CONVEX_URL` and
   `PANTRY_E2E=1`. A debug build fetches its JS from Metro at every launch, so
   the bundler is what decides which backend the app talks to.
4. **The app** — `expo run:<platform> --no-bundler`, which prebuilds the native
   project if `apps/mobile/{android,ios}` is absent (it is gitignored; it is
   generated).
5. **The flows**, with a freshly minted `E2E_EMAIL` for the run.

### Isolation is per account, not per deployment

Every run mints `e2e-<timestamp>-<rand>@example.test` and registers it. That is
the same isolation the browser suite gets from `signUp()`, and
[`e2e-parallelism.md`](e2e-parallelism.md) is the evidence that it is the
isolation that actually matters: across 45 measured runs no spec ever observed
another spec's data, and the per-flow backend provisioning Bluesky builds was
not needed.

That document does flag one thing this change makes newly possible, though:

> If mobile e2e later drives the same deployment concurrently with the browser
> suite, re-run this experiment before assuming that conclusion still holds.

Nothing runs the two suites concurrently today. If BL-0073's nightly job ever
shares a deployment with a browser run, that is the moment to re-measure.

## Where this will break first

**The Convex URL on Android.** `127.0.0.1` inside an emulator is the emulator.
The host is `10.0.2.2`, and `scripts/mobile-e2e.sh` supplies it through
`EXPO_PUBLIC_CONVEX_URL` — one line, in the platform `case`, rather than a
branch inside a flow, because `resolveConvexUrl()` already exists to answer this
question. Two variants it does *not* cover:

- **Genymotion** aliases the host to `10.0.3.2`.
- **A physical device** has no alias at all. Run
  `adb reverse tcp:3210 tcp:3210` and leave the URL at `127.0.0.1`.

Worth knowing: `EXPO_PUBLIC_*` reaches the bundle two different ways.
`babel-preset-expo` inlines `process.env.EXPO_PUBLIC_*` written out in full, and
that is the only mechanism in a release build; in a dev build Metro's serializer
additionally defines those names on the runtime `process.env`. `client.ts`
therefore names the variable explicitly in its default argument — aliasing
`process.env` works in the debug builds this harness uses and silently returns
`undefined` in a release one.

**Tab-bar selectors on Android.** The flow changes tab with
`id: nav.tab.settings`, which reaches React Native's `testID` through
`tabBarButtonTestID`. On iOS that is an `accessibilityIdentifier`; on Android it
is a resource-id, and a handful of React Native components have historically
mapped `testID` to `content-desc` instead. If the tap misses on Android and only
Android, that is the first thing to check —
`maestro hierarchy` prints what the device actually exposes.

## The e2e module substitution seam

`apps/mobile/metro.e2e-source-ext.js`. With `PANTRY_E2E=1`, Metro prefers
`foo.e2e.ts` over `foo.ts`, so a module a UI test cannot drive — push
notification registration, reminder scheduling — can be replaced at bundle time
rather than mocked at runtime.

**There is no `*.e2e.ts` in the tree yet, and that is intentional.** The seam is
here so the first module that needs it is a one-file change instead of a
build-system change made while a nightly is red. It is asserted in
`metro.e2e-source-ext.test.ts` for the same reason: an unused mechanism that is
also untested is one nobody can trust the day they reach for it.

One trap worth recording. Bluesky does this with `RN_SRC_EXT=e2e.ts,e2e.tsx`,
and **copying that env var here would do nothing.** `RN_SRC_EXT` is a
bare-React-Native convention; it appears nowhere in the installed Expo
toolchain — not `@expo/metro-config`, not `metro-config`, not
`babel-preset-expo`. Under Expo the extension list is whatever `metro.config.js`
leaves in `resolver.sourceExts`, so the substitution has to be wired by hand.

The one platform seam this harness *did* need and did not use it for is the
iOS keychain: `clearState` empties an app's data container, and `expo-secure-store`
keeps the session outside it, so a second run would launch already signed in.
Maestro has `clearKeychain` for exactly that, and using the tool's own affordance
beats substituting a module. See `subflows/launch-signed-out.yml`.

## Selectors are the contract

Flows select by `id:` and nothing else. The scheme, and why `testID` is API on
this client rather than a debugging aid, is
[`mobile-testid-conventions.md`](mobile-testid-conventions.md). The strings come
from `@pantry/core/testing`, which is also where the web client's
`data-testid`s come from — so a Maestro flow and the Playwright spec for the
same journey point at the same element by construction rather than by
convention ([BL-0071]).

`apps/mobile/src/testing/e2eSelectors.ts` is the subset this harness drives, and
it is closed: a flow may not use an id that is not declared there, and a
declared id must be used by some flow. Growing it is how BL-0073 grows coverage.

## Troubleshooting

**"Package com.pantry.app is not installed".** The build step did not run or did
not reach the device. `MOBILE_E2E_SKIP_BUILD=1` skips it deliberately; without
that flag, check the Gradle/Xcode output above the failure.

**Sign-up hangs and then fails.** The app cannot reach Convex. Confirm the stack
is up (`curl http://127.0.0.1:3210/version`) and that the URL the bundle got is
right for the device — the runner prints it when Metro starts.

**The second run launches already signed in.** iOS keychain; see
`clearKeychain` above. If it recurs, the flow lost that command.

**Metro will not start.** `apps/mobile/e2e-results/metro.log` has the reason. A
dev server squatting 8081 is the usual one — `MOBILE_E2E_METRO_PORT=8082`.

**Local sign-ups start failing for no reason.** A long-lived local deployment
accumulates e2e accounts until Convex functions breach their 1s limit. Same trap
the browser suite documents; `docker compose down -v` and start over.

[BL-0071]: backlog/BL-0071-portable-test-selectors.md
[BL-0072]: backlog/BL-0072-maestro-e2e-harness.md
[BL-0073]: backlog/BL-0073-nightly-mobile-e2e.md
