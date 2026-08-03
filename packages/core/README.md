# `@pantry/core`

The headless domain layer (BL-0024). Logic that is about *the app*, not about
*the browser*, lives here rather than inside a React component — so it can be
unit-tested without rendering, and so a second client (see
[`docs/superpowers/specs/2026-07-18-mobile-client-design.md`](../../docs/superpowers/specs/2026-07-18-mobile-client-design.md))
can reuse it instead of reimplementing it.

## Entry points

| Import | Contains | May depend on |
| --- | --- | --- |
| `@pantry/core` | Pure functions: week-plan bucketing, the servings clamp, aisle grouping, the import-review draft, quantity formatting | nothing but `@pantry/types` |
| `@pantry/core/react` | Headless hooks: `useAsyncAction`, `useAsyncData`, `useRecipeDraft` | React |
| `@pantry/core/convex` | Optimistic updates against the Convex client cache | `convex`, `@pantry/convex` |

Nothing here may touch the DOM, a renderer, or styling — including the hooks.

## The rule this package exists to enforce

**Domain logic belongs in `@pantry/core` or in Go — never in a component.** A
component should read as presentation over a value the core computed.

Three mechanisms keep that honest, so it doesn't rely on reviewer memory:

1. **`tsconfig.dom-free.json` typechecks the pure + react layers with no DOM
   lib and no ambient `@types`.** A stray `document`, `window`, or `Buffer`
   there is a compile error, not a review comment. It exists as a separate
   project because `src/convex` pulls in the Convex client's declarations, which
   `/// <reference lib="dom" />` and would otherwise hand DOM globals back to the
   whole program.
2. **`biome.json` overrides** (`packages/core/src/**`) deny the browser globals
   that survive type-erasure — including in `src/convex`, which the type-level
   guard can't cover — and ban `react-dom` / stylesheet imports. A second
   override bans `react` itself outside `src/react/`, keeping the pure entry
   point importable by a non-React client.
3. **Tests default to the `node` environment** (`vitest.config.ts`). Only the
   hook tests opt into jsdom, per file, with a `@vitest-environment` docblock —
   so pure logic that quietly grew a DOM dependency fails rather than passes.

## Working here

```bash
pnpm --filter @pantry/core test        # vitest
pnpm --filter @pantry/core typecheck   # shipped code + the DOM-free guard + tests
pnpm --filter @pantry/core build       # tsc -> dist/, what apps/web imports
```

`apps/web` consumes the built `dist/`, so `turbo` builds this package before
typechecking, testing, or building the app.
