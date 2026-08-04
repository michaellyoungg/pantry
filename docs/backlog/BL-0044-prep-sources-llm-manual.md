---
id: BL-0044
title: Prep task sources — LLM-derived and hand-authored, merged with rule output
status: done
area: recipes
effort: M
related_specs: [2026-08-03-cooking-guidance-design.md]
created: 2026-08-03
---

## Context

BL-0042 ships prep tasks from a curated rule table — deterministic, explainable,
and improvable for every recipe at once. It will not cover everything: a recipe
with an unusual technique, or a user who knows their own kitchen better than the
rules do, needs an escape hatch.

The [cooking guidance design](../superpowers/specs/2026-08-03-cooking-guidance-design.md)
settles this as **three producers, one stream, one precedence order** rather than
three competing systems. The schema for it lands with BL-0042; this item turns
the other two producers on.

## Proposal

- **Populate `recipe_prep_tasks(recipe_id, position, window, text, source)`** —
  the table exists from BL-0042, empty. `source` is `llm` or `manual`.
- **Merge precedence `manual > llm > rule`**, deduped by task key. A
  hand-authored task *overrides* the rule that would have produced it rather
  than doubling it — this is the whole reason keys are stable.
- **Manual authoring** — prep tasks are editable on the recipe form: text plus a
  window. Small UI; the model already supports it.
- **LLM-derived prep** — at import, when the rule engine produces nothing for a
  recipe, ask the model for prep tasks and materialize them with `source = llm`.
  Requires an API key that is **not currently configured**, which is why this is
  separated out.
- **LLM equipment/method tagging fallback** (from BL-0041) belongs here too: fill
  `recipe_equipment` and `recipe_methods` when the deterministic keyword scan
  finds nothing. The model's job is to *tag*, not to invent prep advice — prep
  text stays the rule table's responsibility so it remains explainable.
- **Provenance in the UI** — a derived task and a task the user wrote should be
  distinguishable, so an unhelpful rule can be recognized and overridden rather
  than mistrusted wholesale.

## Dependencies

**BL-0042** (rule engine, `recipe_prep_tasks` schema, merge point, stable keys).
The LLM half additionally needs an API key configured; the manual half does not
and can land alone.

## Alternatives considered

- **LLM generates prep instead of the rule table** — rejected as the primary
  source in the umbrella design: non-deterministic, can't be improved
  retroactively without re-importing every recipe, and unexplainable to the user.
  Fine as a gap-filler, which is what this item makes it.
- **Manual-only, no rules** — puts the work on the user for every recipe.
- **Letting all three sources emit freely without precedence** — produces
  duplicate "thaw the chicken" entries from two producers; dedupe by key is the
  cheap fix and the reason keys were made stable in BL-0042.

## Progress

**Manual + precedence: shipped.** `recipe_prep_tasks` now carries a `task_key`,
and `MergePrepTasks` folds stored tasks over the rule table's on-the-fly
derivation, deduped by key with precedence `manual > llm > rule`. A hand-authored
task overrides the rule that would have produced it rather than doubling it; the
three-way case is covered by tests. Writes are scoped by producer, so the recipe
form replaces only `manual` rows and import only `llm` ones — a client that omits
`prepTasks` entirely changes nothing.

Authoring lives in `PrepEditor` on both recipe forms: text plus a window, plus an
*Override* button on each derived task that copies its key onto a new task of the
user's. `PrepSourceBadge` labels every task on Home and recipe detail as
auto / suggested / yours.

**LLM half: built, dark.** `ANTHROPIC_API_KEY` is still unconfigured, so
`NewClaudeTagger` is never constructed and the import path is byte-for-byte what
it was. Behind the key, the tagger fills equipment and methods when the
deterministic keyword scan finds nothing, and picks prep *rules by id* — the text
and window come from `prep_rules.json`, and the response schema has no field for
a sentence the model wrote. Suggestions naming an unknown rule are dropped.
Nothing in this path can invent prep advice, by construction rather than by
prompt.
