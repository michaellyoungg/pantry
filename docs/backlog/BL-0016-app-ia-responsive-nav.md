---
id: BL-0016
title: App IA + responsive navigation shell (5 routes, sidebar ↔ bottom tabs)
status: proposed
area: web
effort: M
related_specs: [2026-07-12-full-app-ux-plan.md]
created: 2026-07-12
---

## Context

The whole app is a single `/` route rendering `RecipeForm`, `RecipeList`, `Catalog`,
`Basket`, and `GroceryList` in one flat grid. Nothing is prioritized and every new
feature has only one place to go: the pile. Fixing the structure is the highest-leverage
first move (Phase 0 of the full-app UX plan) and unblocks the planner, list, recipes, and
pantry work.

## Proposal

- Split `apps/web/src/routes/index.tsx` into five file-based TanStack routes: `/` (Home),
  `/plan`, `/recipes` (+ `/recipes/catalog`, `/recipes/$id`), `/list`, `/pantry`. Existing
  components move almost as-is: `RecipeList`/`RecipeForm` → `/recipes`, `Catalog` →
  `/recipes/catalog`, `Basket` → `/plan`, `GroceryList` → `/list`.
- Add one **responsive nav shell** in `__root.tsx`: labelled **sidebar ≥1024px**, icon
  **rail 640–1024px**, **bottom tab bar <640px**, driven by a single breakpoint hook. No
  new dependencies.
- Settings/profile (household, diet, sign out) behind a menu, **not** a tab.
- Pantry ships as a thin placeholder tab so the slot exists.
- Basic per-section empty states.

## Alternatives considered

- **Keep the single grid** — fine for a skeleton, but blocks any further page-level UX and
  buries the core weekly loop.
- **4 tabs, add Pantry later** — considered, but reserving the 5th slot keeps the IA stable
  and gives the stated waste-reduction pillar a home; the empty state stays honest.
