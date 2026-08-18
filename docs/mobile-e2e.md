# Mobile e2e — the Maestro harness

Status: in force. [BL-0072] built the harness and its first flow; [BL-0073]
grew the flow set to the browser suite's journeys and wired the nightly job.

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
  flows/                    one per journey, named after its Playwright spec
  subflows/                 the fragments those flows share
scripts/install-maestro.sh  pinned CLI installer
scripts/mobile-e2e.sh       the runner
scripts/lib/e2e-stack.sh    the backend, shared with the browser suite
.github/workflows/nightly-mobile-e2e.yml   the nightly job
```

Plus three guards that run in the normal PR gate, because nothing else does:

- `apps/mobile/src/testing/maestroFlows.test.ts` parses the flows and refuses a
  selector, a `runFlow` target, an `env:` key, or a `${VAR}` that does not exist.
- `apps/mobile/src/testing/e2eSelectors.test.tsx` renders the screens the flows
  drive, in the states they drive them into, and refuses a declared selector the
  app no longer emits.
- `apps/mobile/src/testing/flowParity.test.ts` reads `apps/web/e2e` and refuses a
  browser journey with neither a flow nor a written-down reason.

Between them, renaming a `testID` breaks a pull request rather than a nightly
run six hours later, and adding a Playwright spec breaks one rather than
silently widening the gap between the two clients.

## The flow set, and what it is measured against

One flow per journey, **named after the Playwright spec that describes the same
journey**. That naming is the whole mechanism: a missing file is visible parity
drift rather than an unknown gap, and `flowParity.test.ts` fails the PR gate the
moment `apps/web/e2e` grows a spec this side has no answer for.

The answer does not have to be a flow. `apps/mobile/src/testing/flowParity.ts`
records one of three states per journey, and the test insists every browser spec
has exactly one entry:

| | |
| --- | --- |
| **covered** | the flow drives what the spec drives |
| **partial** | the flow exists and drives part of it; `missing` says which part |
| **gap** | there is no flow; `missing` says why |

Where a blocker is a piece of work, `blockedBy` names the backlog item and the
test checks that item exists — a waiver pointing at nothing is how a known gap
becomes an unknown one. It is optional, and an entry **without** one is the most
interesting row in the table: a gap nobody owns.

Today, six of the ten journeys are covered — `core-loop`, `catalog`,
`grocery-list-ux`, `home-dashboard`, `suggest-week` and
`aggregation-and-isolation`. Two are partial and two are gaps, and none of the
four is waiting on a screen:

- **`prep-tasks`** derives the task, badges the planned meal and surfaces the
  card on Home. What it cannot do is tick the task off and prove the tick
  survives a relaunch: the row's `testID` is keyed on
  `stateKey(task.key, cookDate)`, which contains the date the run happens on, so
  no flow can name it in advance. Closing it means giving that row a second,
  date-free selector.
- **`recommendations`** asserts that both halves of the candidate pool answer —
  the flow's own recipe and a catalog row. The web spec goes one further and
  reads the `Uses up:` reason, which is free text with no id, and the flows
  select by id and nothing else.
- **`discover`** has no native surface at all. BL-0063 ported browse, the
  catalog and the kitchen; cold-start discovery — web's "For you" card — was not
  part of it, and no backlog item covers it. This is the one journey with
  neither coverage nor an owner.
- **`nutrition-facts`** waits on [BL-0065]; the native client renders no panel.

### Two rules the flows follow

**Only ids, and only ids something declares.** `e2eSelectors.ts` is the closed
set; a flow may not use an id that is not in it, and an id in it that no flow
uses is deleted. Growing coverage means growing that file.

**A flow may only name a row it caused to exist.** Every grocery line, planned
meal and suggestion a flow asserts on traces back to a recipe that flow
authored (through the add funnel, BL-0063) or added from the catalog. The
counter-example is what the rule is for: `plan-a-week`-style flows that let the
ranker choose the week get a list whose lines are named by whichever dinners it
proposed, so `list.item.<x>` would be a bet on the catalog rather than a
selector. `suggest-week.yml` is the one flow that works that way, and it asserts
only on elements that do not depend on the data.

The fixtures live in `E2E_RECIPES` in `e2eSelectors.ts` — three authored
recipes, two catalog rows — and `maestroFlows.test.ts` pins the titles the flows
type to that table, so a re-worded title cannot leave the ids pointing at
nothing. `garlic` and `baguette` are the ingredients because both are canonical
items in the normalization dictionary: the server hands back "Garlic" and
"Baguette", which slug to the keys the flows already hold.

## The nightly job

`.github/workflows/nightly-mobile-e2e.yml`. Schedule plus `workflow_dispatch`,
iOS and Android as separate jobs, 120-minute timeouts, artifacts on every run.

Per PR the mobile client keeps lint, typecheck and the jest suite — including
the three guards above. Nothing that needs a device runs there. This is the same
split the browser suite has between fast checks and the full loop, and the same
one Bluesky landed on: their `nightly-e2e.yml` books `macos-26-xlarge` for two
hours a night rather than making every pull request wait for a simulator.

### It is off until someone turns it on

Both device jobs are gated on a repository variable, and that is deliberate:

| Job | Variable | Runner | Rough cost |
| --- | --- | --- | --- |
| Android | `MOBILE_E2E_NIGHTLY=enabled` | `ubuntu-latest` | ~$0.50/night private, free public |
| iOS | `MOBILE_E2E_IOS=enabled` | `macos-15` | ~$5/night — macOS bills at 10x Linux |

Neither has ever executed. This repo's CI has been blocked at the account level
before, so nobody should learn the price of a macOS runner from a bill; the
variables make turning each on a decision with a name on it. What *does* run
every night regardless is the `flows` job: it installs the pinned CLI, runs
`maestro check-syntax` over every flow and subflow, and prints which device jobs
are switched on. A nightly doing nothing says so every morning rather than being
quietly absent.

### What each job needs, precisely

**Android — `ubuntu-latest`, with KVM enabled by hand.** An x86_64 emulator
image needs hardware acceleration, and `/dev/kvm` on a GitHub-hosted Linux
runner is not world-writable by default; the job installs the udev rule that
`reactivecircus/android-emulator-runner` documents and then **asserts
`/dev/kvm` is writable before spending twenty minutes on a build**. A
self-hosted runner without nested virtualization fails that check with a message
saying so rather than timing out. (BL-0072's note that "a plain `ubuntu-latest`
runner has no KVM" is what this step is answering: the acceleration is available
on GitHub's Linux images, but only after that rule is in place.)

**iOS — `macos-15`, and the least proven step in the file.** The simulator only
exists on macOS, and Apple does not license it elsewhere; that part is
non-negotiable. The awkward part is Docker: **GitHub's macOS images ship no
Docker daemon**, and the compose stack is the whole backend. The job installs
Colima for one and fails with an explicit message if that does not produce a
working daemon. If Colima is what keeps breaking, the answer is a self-hosted
Mac with Docker already on it, not more retries.

**Both** pay for a native debug build. The first run includes `expo prebuild`
plus a full Gradle or Xcode build: minutes, and gigabytes of toolchain.

### Triage: who owns a red nightly

A nightly suite with no owner decays into noise within a month and is then
deleted. So the rule is written down before the first red run, and the workflow
implements the part it can:

1. **A failed scheduled run files one issue**, titled `Nightly mobile e2e is
   red`, and every later failure comments on that same issue rather than opening
   another. How many nights, and since when, is readable from the thread.
2. **The owner is whoever owns the change that first turned it red.** The run
   links the commits since the last green; on a repo worked by parallel agents
   that is the only attribution that means anything. When it is genuinely
   ambiguous — a flake, an infrastructure change, a catalog edit — it falls to
   whoever owns the item for the area the failing flow names.
3. **Three consecutive red nights and the suite is switched off**, by setting
   the variable back, with a backlog item filed for the fix. Switching it off is
   a deliberate, recorded act; leaving it ringing is how a suite stops being
   read, and a suite nobody reads is worse than no suite because it looks like
   coverage.
4. **A red nightly does not block merges.** It is not on the PR path, and making
   it advisory-but-owned is the trade the whole schedule is built on.

The artifacts are what makes rule 2 possible: Maestro's per-command screenshots
and recordings, `metro.log` (where "the app talked to the wrong backend" shows
up), and the device log — `adb logcat` or a simulator log archive. They upload
on success too, kept 14 days.

### Per-platform tsconfigs: not yet, and here is the trigger

Bluesky keeps `tsconfig.check.ios.json` / `.android` / `.web` so a
platform-conditional file is typechecked under each platform's resolution.
`apps/mobile` has **no `.ios.tsx` / `.android.tsx` file at all**, so the three
configs would typecheck the same files three times and prove nothing. The moment
the first platform-conditional file lands, they become cheap and worth it —
until then they are ceremony, and this paragraph is the reminder rather than the
config.

### What has and has not been verified

Verified against Maestro 2.8.0:

- the published archive's SHA-256 matches the checksum pinned in
  `scripts/install-maestro.sh`;
- every flow and subflow passes `maestro check-syntax`, including the ones added
  by BL-0073;
- `maestro test apps/mobile/e2e` discovers the workspace, selects exactly the
  nine flows and none of the subflows, resolves every `runFlow` target
  (including the object form that passes a recipe title, or `E2E_EMAIL_2`, down)
  and gets each one as far as launching `com.pantry.app`.

Not verified, because this development machine is Linux/WSL2 with no KVM, no
Android SDK and no macOS: **no flow has ever been executed on a device, and no
job in `nightly-mobile-e2e.yml` has ever executed on a runner.** BL-0072 said
the same of its one flow and named the two things most likely to break; both are
still open questions, and they now apply to nine flows instead of one. The
first person with a simulator should expect to fix something. Turning the
Android variable on is how that stops being a guess.

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
5. **The flows**, with two freshly minted accounts for the run — `E2E_EMAIL`,
   and `E2E_EMAIL_2` for the one flow that signs out and checks the next account
   sees none of the first one's data.

### Isolation is per account, not per deployment

Every run mints `e2e-<timestamp>-<rand>@example.test` (and a `-b` sibling) and
registers it. That is
the same isolation the browser suite gets from `signUp()`, and
[`e2e-parallelism.md`](e2e-parallelism.md) is the evidence that it is the
isolation that actually matters: across 45 measured runs no spec ever observed
another spec's data, and the per-flow backend provisioning Bluesky builds was
not needed.

That document does flag one thing this change makes newly possible, though:

> If mobile e2e later drives the same deployment concurrently with the browser
> suite, re-run this experiment before assuming that conclusion still holds.

Nothing runs the two suites concurrently today, and the nightly job does not
change that: each device job brings up its own compose stack on its own runner,
so it shares a deployment with nothing. If that ever stops being true — a shared
staging backend, two platforms pointed at one stack — re-run the experiment
before assuming the conclusion holds.

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

**Tab-bar selectors on Android.** Every flow changes tab by id
(`nav.tab.list`, `nav.tab.pantry`, `nav.tab.settings`), which reaches React
Native's `testID` through `tabBarButtonTestID`. On iOS that is an `accessibilityIdentifier`; on Android it
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
declared id must be used by some flow. Growing it is how coverage grows.

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

**A flow fails on a catalog row — `recipes.catalog-item.garlic-bread`,
`pantry.suggestion.spaghetti-aglio-e-olio`, `plan.suggest-preamble`.** The
catalog is empty, which means the seed job did not run. Three flows rest on it.
Check the `seeding the shared recipe catalog` step in the stack output.

**Local sign-ups start failing for no reason.** A long-lived local deployment
accumulates e2e accounts until Convex functions breach their 1s limit. Same trap
the browser suite documents; `docker compose down -v` and start over.

[BL-0065]: backlog/BL-0065-native-nutrition-surfaces.md
[BL-0071]: backlog/BL-0071-portable-test-selectors.md
[BL-0072]: backlog/BL-0072-maestro-e2e-harness.md
[BL-0073]: backlog/BL-0073-nightly-mobile-e2e.md
