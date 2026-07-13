---
id: BL-0022
title: Persist recipe steps
status: proposed
area: recipes
effort: M
related_specs: [2026-07-12-url-import-recipe-parser-design.md]
created: 2026-07-12
---

## Context

The recipe-service store holds only `{ title, ingredients[] }`. The URL importer
(BL-0001) already **extracts** instruction steps — from schema.org
`recipeInstructions` and from the LLM fallback — but drops them, because there is
nowhere to put them. Manual/edit entry has no steps field either. So a recipe in
Pantry is currently an ingredient list with no method.

## Proposal

Add ordered steps to the recipe model end to end:

- **recipe-service:** a `steps []string` (or `{ number, text }`) field on `Recipe`,
  a `recipe_steps` table (or a JSON column), and read/write support in the store,
  `POST /recipes`, `PUT /recipes/{id}`, and the import preview. The importer already
  produces `ExtractedRecipe.Steps` / `jsonLDRecipe.Steps` — wire them through instead
  of discarding them.
- **Contract:** add `steps` to `packages/types` and the mirrored Go struct.
- **Convex:** carry `steps` through the `create`/`update`/`importFromUrl` actions
  (no recipe bodies in Convex — steps live in recipe-service like ingredients).
- **Web:** show steps in the recipe view; editable in the recipe form; populated by
  URL import.

## Alternatives considered

- Keep steps out of the model and only ever show ingredients — rejected; a recipe
  without a method is half a recipe, and import already has the data.
- Store steps as one free-text blob — workable, but a `[]string` keeps them
  individually renderable/checkable later at almost no cost.
