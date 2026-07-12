# Design: Scaffold TanStack Router (file-based) in `apps/web`

**Date:** 2026-07-12
**Status:** Approved

## Goal

Introduce TanStack Router into the `apps/web` React SPA to prepare for future
multi-page work (e.g. the in-progress `feat-real-auth` effort will likely need
login and protected routes). This is a **scaffolding** task: wire up routing
cleanly while keeping the current single-page UI visually identical.

## Context

- `apps/web` is a Vite + React 19 SPA using Convex.
- All UI currently lives in `src/App.tsx`: a header plus a grid of
  `RecipeForm`, `RecipeList`, `Basket`, and `GroceryList`. `App.tsx` owns a
  `refreshKey` state used to refresh `RecipeList` after a recipe is created.
- `src/main.tsx` renders `<App />` wrapped in `ConvexProvider` inside
  `React.StrictMode`.
- Only `main.tsx` imports `App.tsx`. No tests import it. Existing component
  tests render components directly and are not router-coupled.

## Decisions

- **File-based routing** (TanStack's recommended default) over code-based.
  Less per-route boilerplate, structure mirrors URLs, full type-safety via
  codegen. Better fit for an app expecting more pages.
- **Minimal scope**: preserve the current UI exactly — one root shell + one
  index route. No second/example route.
- **Devtools included** (`@tanstack/react-router-devtools`), dev-only and
  tree-shaken from production builds.
- **Generated route tree gitignored** (`routeTree.gen.ts` is regenerated on
  dev/build). Because `tsc` does not run the Vite plugin, the `typecheck` and
  `build` scripts prepend `tsr generate` (from `@tanstack/router-cli`, config
  in `apps/web/tsr.config.json`) so a clean checkout generates the tree before
  `tsc` runs. Without this, `tsc -b` fails on a fresh clone with
  `Cannot find module './routeTree.gen'`.

## Design

### Dependencies (in `apps/web`)

- `@tanstack/react-router` — runtime router.
- `@tanstack/react-router-devtools` — dev dependency, dev-only devtools panel.
- `@tanstack/router-plugin` — dev dependency, Vite plugin that generates the
  route tree at dev/build.
- `@tanstack/router-cli` — dev dependency, provides the `tsr generate` command
  used by the `typecheck`/`build` scripts to generate the tree ahead of `tsc`.

### Vite config (`vite.config.ts`)

Add the TanStack Router plugin **before** `react()` (required ordering):

```ts
import { tanstackRouter } from "@tanstack/router-plugin/vite";

plugins: [
  tanstackRouter({ target: "react", autoCodeSplitting: true }),
  react(),
  tailwindcss(),
]
```

This generates `src/routeTree.gen.ts` on dev/build.

### Route files (new `src/routes/`)

- **`__root.tsx`** — the app shell. Holds the current `<header>` (🥕 Pantry)
  and renders `<Outlet />` where page content goes. Mounts the router devtools
  (dev-only).
- **`index.tsx`** — the `/` route. Contains today's grid (`RecipeForm`,
  `RecipeList`, `Basket`, `GroceryList`), including the `refreshKey` state,
  moved verbatim from `App.tsx`.

### Wiring (`src/main.tsx`)

Replace `<App />` with the router, keeping `ConvexProvider` as the outer
provider:

```tsx
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

const router = createRouter({ routeTree });

// render:
<ConvexProvider client={convex}>
  <RouterProvider router={router} />
</ConvexProvider>
```

`src/App.tsx` is removed; its content is split between `__root.tsx` (header)
and `index.tsx` (grid).

### TypeScript registration

Register the router instance type for full type-safety (in `main.tsx`):

```ts
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
```

### gitignore

Add `apps/web/src/routeTree.gen.ts` to `.gitignore`.

## Verification

- `routeTree.gen.ts` is generated on `pnpm --filter @pantry/web dev` (or a
  build).
- `pnpm --filter @pantry/web typecheck` passes.
- `pnpm --filter @pantry/web test` passes — existing component tests are
  unaffected (they render components directly, not routes).
- App renders identically at `/`: header + the four-panel grid, `refreshKey`
  behavior intact.

## Out of scope (YAGNI)

- No second/example route, no nav bar.
- No auth routes or route guards.
- No loaders, no search-param wiring, no route-level data fetching.

These arrive with the actual future features, not this scaffold.
