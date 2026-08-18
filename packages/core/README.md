# `@pantry/core`

The headless domain layer (BL-0024). Logic that is about *the app*, not about
*the browser*, lives here rather than inside a React component — so it can be
unit-tested without rendering, and so a second client (see
[`docs/superpowers/specs/2026-07-18-mobile-client-design.md`](../../docs/superpowers/specs/2026-07-18-mobile-client-design.md))
can reuse it instead of reimplementing it.

## Entry points

| Import | Contains | May depend on |
| --- | --- | --- |
| `@pantry/core` | Pure functions: week-plan bucketing, the servings clamp, aisle grouping, the import-review draft, quantity formatting, the nutrition rollup (when a figure may be shown at all, and what it is missing), goal evaluation and the diet presets it reads — plus `NAV_ITEMS`, the shared list of navigation destinations | nothing but `@pantry/types` |
| `@pantry/core/react` | Headless hooks: `useAsyncAction`, `useAsyncData`, `useRecipeDraft` | React |
| `@pantry/core/convex` | Optimistic updates against the Convex client cache | `convex`, `@pantry/convex` |
| `@pantry/core/data` | One headless hook per screen: `useGroceryList`, `useHome`, `usePantry` | React, `convex/react`, `@pantry/convex`, and the three above |

Nothing here may touch the DOM, a renderer, or styling — including the hooks.

## Navigation destinations (`NAV_ITEMS`)

BL-0054. The seven primary destinations — path, label, and icon — live in
`src/nav.ts` so both clients read one list.

```ts
import { NAV_ITEMS, type NavIconName } from "@pantry/core";
```

`icon` holds a **name**, not a component:

```ts
{ to: "/list", label: "List", icon: "ShoppingCart" }
```

`lucide-react` and `lucide-react-native` export identical names, so each client
binds the name to its own component in its own view layer and nothing
renderer-specific crosses the boundary — which is what lets this module stay in
the headless entry point. The web binding is `NAV_ICONS` in
`apps/web/src/components/Nav.tsx`; the native one is `NAV_ICONS` in
`apps/mobile/src/navigation/navIcons.ts`. Both are typed
`Record<NavIconName, …>`, so adding a destination here fails the build on
whichever platform has not bound its icon.

Two things about `NavItem` are load-bearing beyond appearance:

- **`label` is the link's accessible name.** The Playwright `navigateTo` helper
  and `Nav.test.tsx` both locate by it, so icons must render `aria-hidden`.
- **`to` is a route path (`NavRoute`), not a router object.** Rule 5 of the
  mobile design spec keeps routers out of shared code; each client maps the
  path itself, and can key an exhaustive `Record<NavRoute, …>` off it —
  `apps/mobile/src/navigation/navItems.ts` does exactly that for its Expo
  Router route names.

## Screen hooks (`@pantry/core/data`)

BL-0055. A screen hook owns everything about a screen that is *not* rendering:
its Convex subscriptions, its mutations and their optimistic updates, and every
value derived from them. It returns data, actions and derived state. A view over
one is presentation.

```tsx
const { groups, inCart, undo, error, toggle, undoRemove } = useGroceryList();
```

Convex's React hooks run unchanged under React Native, so `apps/web` and
`apps/mobile` (BL-0056) share these **verbatim** — the wiring is authored once,
and the two clients cannot drift into fetching different fields or handling
errors differently.

### Writing one

1. **Name it for the screen** (`useGroceryList`, `usePantry`), not for the table.
2. **Export a named `Use*` return type.** It is the contract two clients read;
   an inferred shape is not reviewable, and it is what lands in the `.d.ts`.
3. **Derive row types from the query** —
   `FunctionReturnType<typeof api.pantry.list>[number]`. Restating a row by hand
   erases Convex's `Id` brand on `_id`, every mutation takes the branded id, and
   only `tsc` ever catches it — never Vitest.
4. **Build on what is here.** `@pantry/core` for the pure derivations
   (`groupByAisle`, `partitionCart`), `@pantry/core/react` for
   `useAsyncAction`/`useAsyncData`, `@pantry/core/convex` for optimistic updates.
5. **Leave per-platform concerns in the view**: which sheet is open, whether a
   disclosure is expanded, confirmation prompts, animation, navigation. A hook
   may own an animation's *duration* and *which rows are mid-flight* — both
   clients need those — but never the animation itself. Instrumentation is one
   of these: `useHome` accepts the generate action as an optional argument so
   `apps/web` can hand it the traced wrapper BL-0027 built, while *whether and
   when* to call it stays in the hook.

`src/data` is the one subtree besides `src/react` allowed to import React, and
the one besides `src/convex` excluded from `tsconfig.dom-free.json` (the Convex
client declarations `/// <reference lib="dom" />`). The `biome.json` ban on
browser globals still applies, so `document`/`window` remain errors there.

### Migrated screens

Screens move one at a time, as the native client reaches them — never as one
refactor across all 11 routes. Routes not listed still wire Convex in their
components, and carry their own migration when they are ported.

| Screen | Hook | Web view |
| --- | --- | --- |
| Grocery list | `useGroceryList` | `apps/web/src/components/GroceryList.tsx` |
| Home | `useHome` | `apps/web/src/components/Home.tsx` |
| Pantry | `usePantry` | `apps/web/src/components/Pantry.tsx` |

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
