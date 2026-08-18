# `@pantry/mobile`

The native client — one Expo app for iOS and Android, peer to `apps/web`, not a
package. It speaks to the same self-hosted Convex deployment and shares the same
headless domain layer.

Delivered by [BL-0056](../../docs/backlog/BL-0056-expo-app-foundation.md); the
architecture is
[`docs/superpowers/specs/2026-08-16-mobile-client-parity-design.md`](../../docs/superpowers/specs/2026-08-16-mobile-client-parity-design.md).

**No view code is shared with `apps/web`, in either direction.** What is shared
is `@pantry/core` (pure logic), `@pantry/core/react` (headless hooks),
`@pantry/core/data` (one headless hook per screen) and `@pantry/design-tokens`
(palette as data).

## Ported screens

| Route | Status | Item |
| --- | --- | --- |
| `index` (home) | ported — `src/home/` | [BL-0062](../../docs/backlog/BL-0062-native-home-dashboard.md) |
| `list` | ported — `src/grocery/`, offline-capable | [BL-0057](../../docs/backlog/BL-0057-native-grocery-list.md), [BL-0058](../../docs/backlog/BL-0058-offline-grocery-cache-replay.md) |
| `pantry` | ported — `src/pantry/` | [BL-0059](../../docs/backlog/BL-0059-native-pantry.md) |
| `recipe/[id]`, `recipe/[id]/cook` | ported — `src/cooking/` | [BL-0061](../../docs/backlog/BL-0061-native-cooking-mode.md) |
| everything else | placeholder | see each screen's `portedBy` |

The recipe routes are a **stack**, not a tab: cooking is entered from a specific
meal and left again, and the tab bar is the shared destination list in
`@pantry/core` (BL-0054), which they are deliberately not part of.

A ported screen is presentation over a `@pantry/core/data` hook and nothing
else. If a screen needs domain logic that is not in one of those hooks yet, the
logic goes into the hook — not into the view, and not into a second copy beside
web's.

## Running it

```bash
pnpm --filter @pantry/mobile start          # Metro; press i / a for a simulator
pnpm --filter @pantry/mobile start:tunnel   # reachable from a physical device
pnpm --filter @pantry/mobile typecheck
pnpm --filter @pantry/mobile test
pnpm test:e2e:mobile --platform android     # Maestro, from the repo root
```

`typecheck` and `test` also run from the repo root (`pnpm typecheck`,
`pnpm test`) and are part of the per-PR CI gate.

### Pointing it at a backend

The simulator shares the host's loopback, so the compose stack works unchanged.
A **physical device does not** — `127.0.0.1` is the phone's own loopback, not
yours. Until [BL-0006](../../docs/backlog/BL-0006-railway-deploy.md) puts
Convex on a public host, use a dev tunnel and override the URL:

```bash
EXPO_PUBLIC_CONVEX_URL=https://<your-tunnel>.example pnpm --filter @pantry/mobile start:tunnel
```

Resolution order is `EXPO_PUBLIC_CONVEX_URL` → `extra.convexUrl` in `app.json` →
`http://127.0.0.1:3210`. See `src/convex/client.ts`.

## Metro reads workspace *source*, not `dist/`

This is the piece most likely to bite someone, so it is worth understanding
before changing it.

`@pantry/core` and friends publish `dist/` through their `exports` map, built by
`turbo run build`. Metro has no build step, so with default resolution the
simulator runs whatever `dist/` happens to be on disk — a stale build. This repo
has been bitten twice, and the failure is nasty because `tsc` reads the same
stale `.d.ts` and stays green: **a runtime error with no type error.**

So `metro.workspace-source.js` redirects those packages to `packages/*/src`.
There is then no artifact to go stale and no dependency on turbo ordering. Two
rewrites are involved, and doing only the first is the classic half-working
version:

1. the package specifier — `@pantry/core/react` → `packages/core/src/react`;
2. the **relative** imports inside those sources, which use TypeScript's
   `.js`-extension convention (`from "./colors.js"`) and point at files that
   only exist after a build.

The same module is the Jest resolver (`jest.resolver.js`) and `tsconfig.json`
uses matching `paths`, so Metro, Jest and `tsc` all read one copy of each
package. `metro.workspace-source.test.ts` asserts none of them can reach `dist/`,
including a check that every dist-shipping `@pantry/*` dependency is in the map.

`@pantry/convex` is deliberately *not* redirected: it has no build step, and its
`convex/_generated/*.js` are checked-in sources already.

To convince yourself: delete every `packages/*/dist` and run
`npx expo export --platform ios`. It bundles.

## Auth and `expo-secure-store`

`ConvexAuthProvider` defaults to `localStorage`, which React Native does not
have, so `storage` is required. It writes two values — the JWT and the refresh
token — under keys namespaced by the deployment URL, with every non-alphanumeric
character stripped.

iOS SecureStore warns above **2048 bytes per value**, and a JWT grows with its
claims. Rather than wait to discover that ceiling in production on the accounts
with the most data, `src/convex/secureTokenStorage.ts` splits an oversized value
across numbered keys behind a sentinel. Values under the limit are stored whole,
so the common path is one read and one write and nothing needs migrating.

## Tests

`jest-expo` + React Native Testing Library — a deliberate divergence from the
repo's Vitest standard, scoped to this app, because Vitest cannot drive React
Native. Shared logic stays on Vitest in `packages/core`, which is where the
behavioural weight belongs.

Selectors are `testID`s, and the scheme is a contract:
[`docs/mobile-testid-conventions.md`](../../docs/mobile-testid-conventions.md).
It lives in `@pantry/core/testing` (BL-0071), which the web client reads too —
`src/testing/testIDs.ts` is a re-export, so screens keep importing it from
there. The same strings are that client's `data-testid` values, which is what
lets a Maestro flow and a Playwright spec describe one journey.

Device e2e is Maestro, in `e2e/`
([BL-0072](../../docs/backlog/BL-0072-maestro-e2e-harness.md)): one flow, run
locally with `pnpm test:e2e:mobile --platform android|ios` against a booted
simulator or emulator. It is not a merge gate — a native build plus a device
image is far too slow — and the nightly job that runs it is
[BL-0073](../../docs/backlog/BL-0073-nightly-mobile-e2e.md). What *is* in the PR
gate is the pair of guards in `src/testing/`: one parses the flows and rejects a
selector the app no longer emits, the other renders the screens and rejects a
declared selector nothing renders. See
[`docs/mobile-e2e.md`](../../docs/mobile-e2e.md).

## Screens

`app/(tabs)/*.tsx` are route files and nothing else — each renders a component
from `src/`. The grocery list
([BL-0057](../../docs/backlog/BL-0057-native-grocery-list.md)) is the first real
one and sets the pattern for the rest:

- **Every value on screen comes from a `@pantry/core/data` hook and
  `@pantry/core`.** The
  aisle grouping, what to buy, what the recipes wanted, what is left over — all
  of it is the same code the web screen renders from. A rule about groceries
  written in `src/grocery/` would be a rule the two clients can disagree about.
- **What the native file owns is interaction.** `src/grocery/hitTargets.ts`
  carries the sizes, with the reasoning, and its numbers are asserted in tests
  rather than left as utility classes: this screen is used one-handed while
  pushing a trolley, and 44pt assumes a hand that is not moving.
- **Mis-aims land on the reversible action.** The check-off target is the whole
  row and is the *only* thing in its band; provenance, remove and "need it
  anyway" sit below it, small and hit-slopped. Tapping the wrong thing costs one
  more tap, never an undo.
- **Sheets are bottom sheets, and are in-tree rather than `Alert.alert`** — the
  top of a phone is out of thumb reach, and an OS alert cannot be tested.

Home (`src/home/`,
[BL-0062](../../docs/backlog/BL-0062-native-home-dashboard.md)) is the launch
screen, and follows the same split. Which single next action to offer is
`deriveHomeState` in `@pantry/core`, reached through `useHome()`; the web
dashboard renders from the same hook, so the two clients cannot reach different
conclusions about the same account. What this client decides is layout and
routing — the week strip is seven full-width rows rather than seven columns,
because forty points per day is an ellipsis, and CTAs stack rather than sitting
side by side. `tabHref()` in `src/navigation/navItems.ts` is the one place a
shared destination becomes an Expo Router href, and `recipeHref()` /
`cookModeHref()` beside it do the same for the stack routes below.

Cooking (`src/cooking/`,
[BL-0061](../../docs/backlog/BL-0061-native-cooking-mode.md)) is the other place
this client earns its existence, and the split is the same again: the recipe,
its derived lead-time prep (BL-0042) and the equipment catalog come from
`useRecipeDetail()` / `usePlanPrep()`, and every label — cook time, cuisine,
prep windows, cooking methods — is a `@pantry/core` helper the web surfaces call
too. What is native:

- **`CookModeScreen` has no web counterpart.** A laptop sits still on a desk;
  a phone is propped against a mixing bowl. So the method becomes one step at a
  time, drawn at a size deliberately outside the token scale
  (`src/cooking/legibility.ts`, the reasoning and the numbers, asserted in
  tests like `hitTargets.ts` is), and the screen is held awake for exactly as
  long as that screen is mounted rather than for as long as the app is open.
- **Recipe detail is a screen, not a disclosure.** Web expands a recipe row
  inside a list you are deciding from; arriving here means you are about to
  cook this thing, so it leads with the action and with what should already
  have happened, and puts ingredients before the method.
- **Prep check-off is the whole row.** Web draws a 16px checkbox next to a
  mouse. The tick is optimistic in the shared hook, because a controlled Convex
  checkbox without one appears to do nothing and then jump.

### Offline (BL-0058)

The grocery screen's data source is `useOfflineGroceryList`, and it is the only
surface in the app with one — offline scope is the grocery list and nothing
else. Three pieces:

- **`@pantry/core`'s `groceryOffline.ts`** is the reconciliation, and it is pure:
  the composite key a line keeps across a regeneration, the collapse of the
  queue to one intent per line, the replay plan, and the cache codec. The
  interesting cases are tested there, without a renderer.
- **`@pantry/core/data`'s `useOfflineGroceryList`** is the wiring: read the
  cache on mount, queue a tap when the socket is down, replay on reconnect.
- **`src/offline/groceryCacheStore.ts`** is the device half — `AsyncStorage`,
  not `expo-secure-store` (a list is not a secret, and SecureStore warns above
  2048 bytes per value).

What this screen owns is the two things the shopper is told: `OfflineBanner`
(this is happening) and `ReplayConflictSheet` (one queued tick could not be
settled — which of the two answers do you want). A queued check-off that cannot
be replayed is never dropped silently: it lost a real purchase *and* the pantry
inflow that purchase writes.

## Styling

NativeWind (Tailwind v3) bound to `@pantry/design-tokens`.
`scripts/generate-tailwind-theme.mjs` renders the tokens into
`_generated/tailwind-theme.js`, the mobile twin of web's
`theme.generated.css` — the same data rendered twice rather than a palette
hand-copied into a second place. `pnpm --filter @pantry/mobile test` re-renders
and fails on drift.

The generator already looks for the scale groups
[BL-0053](../../docs/backlog/BL-0053-design-tokens-beyond-color.md) adds
(spacing, radii, typography) and picks them up as soon as they are exported —
which means the drift check fails once, on purpose, as the prompt to regenerate.

## Known gaps

- `@pantry/convex` and `@pantry/types` are **not** direct dependencies, and
  still do not need to be. `@pantry/core/data` owns the `@pantry/convex/api`
  import on the app's behalf, and every reference to `@pantry/types` (the
  `Recommendation` row on the pantry screen; `Ingredient` and `PrepSource` in
  `src/cooking/`) is `import type`, so it is erased before anything has to
  resolve it. Both are in the Metro source map already,
  so the first screen needing a *runtime* import only adds a line to
  `package.json`.
- `@pantry/core/data` ([BL-0055](../../docs/backlog/BL-0055-core-data-screen-hooks.md))
  is what real screens call — see `src/grocery/` and `src/pantry/` for the
  worked examples. The remaining placeholder screens are deliberately thin so
  none of that work is duplicated here; the resolver test proves the entry point
  resolves to source.
- No app icon or splash screen — that is
  [BL-0060](../../docs/backlog/BL-0060-eas-private-distribution.md), along with
  EAS build and distribution.
