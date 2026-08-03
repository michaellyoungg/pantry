---
id: BL-0042
title: Prep rule engine — derived lead-time tasks (thaw, soften, preheat) on Home
status: in-progress
area: recipes
effort: L
related_specs: [2026-08-03-cooking-guidance-design.md]
created: 2026-08-03
---

## Context

Some cooking work has to happen before the day you cook: move the chicken out of
the freezer, set the butter out, light the smoker. None of it is reliably in a
recipe's instructions, and hand-authoring it per recipe never scales.

The key insight from the
[cooking guidance design](../superpowers/specs/2026-08-03-cooking-guidance-design.md):
a step that says "preheat the oven" is recipe content, but the *fact* that baking
implies preheating is knowledge about baking. Derive it and it applies to every
recipe already in the database, and improves for all of them at once.

## Proposal

- **Rules as a versioned data file**, loaded at boot like the normalizer's data
  (`mustLoadNormalizer`) — not a table. Curated reference data that ships with
  the service; a table would buy nothing and cost a migration per rule edit.
  Each rule is `{id, when, window, text, priority}`.
- **`DerivePrepTasks(recipe, cookDate) []PrepTask`** — a pure Go function. No
  I/O, no clock, no database, so the bulk of coverage is table-driven unit tests.
- **Matching:**
  - *Ingredient rules* key on `Normalizer.CanonicalItem` plus state words parsed
    from the ingredient note/text (`frozen`, `softened`, `room temperature`,
    `dried`). This needs **no new per-recipe tagging** — every recipe already in
    the database gets these the moment a rule ships.
  - *Method* and *equipment* rules key on the tags from BL-0041.
- **Add an optional `category` to `normalization.json` items.** Rules want "this
  is a protein", not "this is in the meat aisle"; `aisle` is the wrong axis and
  is the only classification the dataset has today.
- **`prep_window`, not `window`,** as the column name in `recipe_prep_tasks` —
  `WINDOW` is a Postgres reserved word and the DDL is a syntax error otherwise.
- **Windows**, relative to the cook date, day granularity only:
  `three_days_before`, `two_days_before`, `night_before`, `morning_of`,
  `hour_before`, `at_start`. A frozen turkey and a chicken breast both thaw but
  don't belong in the same bucket.
- **Stable keys** — `ruleID + ":" + subject`, so check-off survives
  re-derivation and recipe edits. Editing a rule's text preserves state;
  changing a rule's `id` deliberately does not.
- **Priority supersession** — when two rules produce the same subject the higher
  priority wins and the loser is dropped (the large-frozen-roast rule supersedes
  the generic thaw rather than emitting both).
- **`POST /prep-tasks`** taking `[{recipeId, cookDate}]` → grouped tasks. Same
  call shape as the grocery-list aggregation, so the Convex action and
  auth/secret plumbing are unchanged.
- **Convex `prepTaskState(userId, taskKey, cookDate, done)`** — check-off,
  mirroring `groceryList.checked`.
- **Surfaces:** a "Before you cook" card on Home listing this week's tasks due
  today (Home is already state-aware from BL-0017 — this is one more state); a
  "before you start" list on recipe detail; a badge on planner `MealCard`s that
  carry lead-time prep, so a 24-hour thaw is visible when you *schedule* the
  meal, not the night you forgot.

## Dependencies

**BL-0022** (steps) and **BL-0041** (equipment + method tags). Ingredient rules
would technically work without either, but method and equipment rules — half the
value, and all of the "light the smoker" behaviour — need BL-0041.

**BL-0031** (normalization dictionary coverage) is a *soft* dependency.
`normalization.json` holds 5 items across 3 aisles today, with no meat or poultry,
so a "thaw the chicken" rule matches nothing until the dictionary grows. That does
not block building the engine, but it does bound how useful ingredient rules are on
day one. Method- and equipment-driven rules are unaffected.

## Alternatives considered

- **Prep authored per recipe by the user** — no engine, but the work lands on
  the user for every recipe and never reaches the notification experience.
  Survives as one of three sources in BL-0044, not as the mechanic.
- **LLM derives prep at import** — handles anything, but non-deterministic,
  can't be improved retroactively without re-importing, and needs an unconfigured
  key. Also BL-0044.
- **Clock times on planned meals** — more precise scheduling, but adds a setting
  or planner friction BL-0018 deliberately avoided. Relative windows carry this;
  upgrading to timestamps later is additive.
- **Deriving in Convex** — rejected: Convex holds no recipe bodies and its
  queries can't do network I/O.
