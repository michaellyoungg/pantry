---
id: BL-0041
title: Equipment catalog + recipe equipment/method tagging (with import detection)
status: done
area: recipes
effort: M
related_specs: [2026-08-03-cooking-guidance-design.md]
created: 2026-08-03
---

## Context

A recipe today says nothing about what hardware it needs. That blocks three
things at once: a "before you start" list can't mention lighting a smoker, the
prep rule engine (BL-0042) has no equipment or method tags to key rules on, and
the app can't answer "I just got a sous-vide — what can I cook?" (BL-0043).

Modeling equipment as free-text strings on the recipe would be cheapest, but
strings can't be matched against an inventory, so the discovery experience would
need a migration later. The
[cooking guidance design](../superpowers/specs/2026-08-03-cooking-guidance-design.md)
models it as real entities up front.

## Proposal

- **`equipment` table** — curated catalog, reference data not user data:
  `id` (slug), `name`, `category` (`appliance` | `cookware` | `tool`),
  `aliases[]`. Seeded with oven, stovetop, slow cooker, sous-vide circulator,
  panini press, air fryer, smoker, grill, pressure cooker, stand mixer, blender.
- **`recipe_equipment(recipe_id, equipment_id, required)`** — `required = false`
  keeps "a grill pan works too" expressible and keeps optional gear from
  blocking BL-0043's "can I make this?" check.
- **`recipe_methods(recipe_id, method)`** — closed enum: `bake`, `roast`,
  `grill`, `smoke`, `sous_vide`, `slow_cook`, `pressure_cook`, `fry`, `saute`,
  `boil`, `marinate`, `no_cook`. Closed because BL-0042's rules key on it; an
  open vocabulary makes rules unwritable.
- **Import detection, deterministic and LLM-free.** JSON-LD `cookingMethod` maps
  onto the method enum; otherwise a keyword scan over step text driven by the
  same `aliases` column ("crock pot" → `slow_cooker` + `slow_cook`, "immersion
  circulator" → `sous_vide_circulator` + `sous_vide`, "preheat the oven" →
  `oven` + `bake`). One alias table serves both detection and display.
- **Contract + UI:** `equipment` and `methods` on the `Recipe` type in
  `packages/types` and the mirrored Go struct; carried through the Convex
  create/update/import actions; editable in the recipe form and shown on recipe
  detail, so a wrong guess is one correction away.
- **Catalog:** populate equipment and methods for curated `catalog.json` entries.

## Dependencies

Depends on **BL-0022** (persist recipe steps) landing first — the keyword scan
reads step text, which main does not store yet. BL-0022's implementation exists
but stranded on `origin/worktree-myoung-bl-0022-recipe-steps` behind a
squash-merged claim PR; it has to be recovered onto main before this starts.

Overlaps **BL-0030** (recipe discovery metadata) — same files, both wire new
JSON-LD fields. Split the import claim: BL-0030 owns `recipeCategory` and
`keywords`, this item owns `cookingMethod`. Whoever lands second rebases.

## Alternatives considered

- **Free-text equipment strings** — cheapest, but unmatched against inventory;
  rejected, it defers a migration rather than avoiding one.
- **Open method vocabulary** — flexible, but BL-0042's rules can't be written
  against tags that vary per recipe.
- **LLM tagging as the primary path** — no key is configured and the scan covers
  the common cases; LLM is the fallback in BL-0044, not the default.
