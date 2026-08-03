---
id: BL-0022
title: Persist recipe steps
status: in-progress
area: recipes
effort: M
related_specs:
  [2026-07-12-url-import-recipe-parser-design.md,
   2026-08-03-cooking-guidance-design.md]
created: 2026-07-12
---

## ⚠️ This work is written but never landed

The implementation exists and is complete — Go store and schema, `packages/types`,
Convex actions, and web UI (`StepsEditor.tsx`, steps on `RecipeDetails`, import
wiring; ~450 lines across 24 files) — but it is **not on `main`**.

PR #40 is marked merged, but its merge commit is the *claim* commit
(`chore(backlog): claim BL-0022`). The implementation was pushed to the branch
**after** the squash-merge and stranded there. As of `origin/main` `4274120`,
`Steps` appears zero times in `apps/recipe-service/internal/recipe/types.go`.

The work is at `origin/worktree-myoung-bl-0022-recipe-steps`:

- `4526de1` — `feat(recipe-service): persist recipe steps end to end`
- `0c29db6` — `feat(web): edit, import, and view recipe steps`

**Recovering that branch onto main is all this item needs.** Rebase it (main has
moved a long way since July) rather than reimplementing. It is a prerequisite for
BL-0041 and BL-0042 — the equipment keyword scan reads step text.

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
