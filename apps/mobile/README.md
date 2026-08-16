# `@pantry/mobile`

The native client — one Expo app for iOS and Android, peer to `apps/web`, not a
package. It speaks to the same self-hosted Convex deployment and shares the same
headless domain layer.

Delivered by [BL-0056](../../docs/backlog/BL-0056-expo-app-foundation.md); the
architecture is
[`docs/superpowers/specs/2026-08-16-mobile-client-parity-design.md`](../../docs/superpowers/specs/2026-08-16-mobile-client-parity-design.md).

**No view code is shared with `apps/web`, in either direction.** What is shared
is `@pantry/core` (pure logic), `@pantry/core/react` (headless hooks) and
`@pantry/design-tokens` (palette as data).

## Running it

```bash
pnpm --filter @pantry/mobile start          # Metro; press i / a for a simulator
pnpm --filter @pantry/mobile start:tunnel   # reachable from a physical device
pnpm --filter @pantry/mobile typecheck
pnpm --filter @pantry/mobile test
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

Device e2e (Maestro) is [BL-0072](../../docs/backlog/BL-0072-maestro-e2e-harness.md)
and runs nightly, not as a merge gate.

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

- `@pantry/convex` and `@pantry/types` are **not** direct dependencies. Nothing
  here imports them yet — `@pantry/core/data` owns the `@pantry/convex/api`
  import on the app's behalf — and a declared-but-unused dependency is just
  something for Knip to flag. Both are in the Metro source map already, so the
  first screen that needs one only adds a line to `package.json`.
- `@pantry/core/data` ([BL-0055](../../docs/backlog/BL-0055-core-data-screen-hooks.md))
  is what real screens should call. Placeholder screens are deliberately thin so
  none of that work is duplicated here; the resolver test proves the entry point
  resolves to source.
- No app icon or splash screen — that is
  [BL-0060](../../docs/backlog/BL-0060-eas-private-distribution.md), along with
  EAS build and distribution.
