---
id: BL-0007
title: OpenAPI contract codegen
status: done
area: infra
effort: M
related_specs: [2026-06-29-recipe-to-grocery-list-design.md]
created: 2026-06-29
---

## Context

The recipe-service HTTP contract is hand-written twice in Milestone 1:
TypeScript types in `packages/types` and mirrored Go structs. This guarantees
drift — they will silently diverge and surface as a serialization mismatch at a
bad time.

After Plan 2a, the grocery-list line shape (`{item,unit,quantity}`) is now
written in **four** places: the Go `GroceryLine` struct, `@pantry/types`, a
local `type` in `convex/recipes.ts`, and an inline validator in
`convex/groceryList.ts`. `@pantry/convex` does not yet depend on `@pantry/types`.
As a cheap interim step (before full OpenAPI codegen), have `@pantry/convex`
import the line/ingredient types from `@pantry/types` to collapse the two
JS-side copies.

**Progress:** the interim JS-side collapse landed first (`@pantry/convex`
depends on `@pantry/types`, `convex/recipes.ts` uses the shared `GroceryLine`,
and `convex/groceryList.ts` derives its validator with a compile-time guard).
The full contract landed next — see Outcome.

## Proposal

Establish a single source of truth for the contract before it grows complex:
write an OpenAPI spec and generate the TypeScript client/types and Go
server types from it. Wire generation into the Turborepo task graph so it stays
current.

## Alternatives considered

- Define in Go and generate TS (or vice versa) — viable; OpenAPI is more neutral
  across the TS/Go split. Decide when picked up.
- Keep hand-writing — only acceptable while the contract is tiny (M1).

## Outcome

`contract/openapi.yaml` is now the single source of truth for all 22 endpoints
and every shape that crosses the boundary. See
[`contract/README.md`](../../contract/README.md).

- **TypeScript is generated.** `packages/types/src/contract.generated.ts` is
  rendered from the spec and re-exported by `@pantry/types`, so no wire type is
  hand-written on the JS side any more. The two remaining local mirrors in
  Convex (`NormalizedItem` in `recipes.ts`, `PricingLine` in `pricing.ts`) are
  gone with it.
- **Go is checked, not generated**, and that is a decision rather than a
  shortcut: the wire structs live in four packages that are kept apart on
  purpose (`internal/recommend` imports *nothing*), and aliasing them onto one
  generated package would delete those boundaries. Instead the generator emits a
  binding table and `apps/recipe-service/internal/contract` reflects each struct
  against it — names, kinds, presence and nullability.
- **Routes are checked too.** `NewRouterWithImporter` now registers from a route
  table, and `recipe.RoutePatterns()` is compared to the spec's `paths`, so an
  endpoint cannot be served without being written down.
- **CI enforces it.** `pnpm contract:check` re-renders and fails on staleness
  (Node job, alongside `backlog:index:check`); `go test ./...` runs the
  conformance tests (Go job); `scripts/contract-codegen.mjs` has its own suite in
  `packages/types`.

The audit found and fixed real drift on the way in: `Recommendation.nutritionFit`
and `.nutritionUnverified` were optional in TypeScript but always emitted by Go,
`RecommendationMissingItem.staple` likewise, and `EquipmentDef` was missing
`implies` entirely.
