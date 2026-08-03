---
id: BL-0028
title: Pantry cook-decrement — step ingredients have→low→out when a recipe is marked cooked
status: in-progress
area: pantry
effort: M
related_specs: [2026-07-18-pantry-thin-loop-design.md]
created: 2026-08-03
---

## Context

BL-0021 increment 1 shipped the pantry inflow loop (auto-add from grocery
check-off) and don't-rebuy, but split cook-decrement out as **increment 2**
because its prerequisite does not exist yet. The pantry proposal (BL-0021)
names cook-decrement as *"the only outflow signal that survives; gates
everything downstream,"* and the increment-1 design
(`docs/superpowers/specs/2026-07-18-pantry-thin-loop-design.md`, "Deferred
work") records why it was deferred: it needs a **`markCooked` event on
`basket`**, which is BL-0018's (meal planner) territory and **was never built** —
a grep finds `markCooked` only in prose, never in code.

Without an outflow signal, pantry rows only move out of `have` via the manual
have→low→out cycle that increment 1 added as the escape hatch. Cook-decrement is
what makes the loop close automatically.

## Proposal

- **Depend on / land a `markCooked` event first.** Marking a planned recipe
  "cooked" in the planner (BL-0018) must emit a signal carrying the recipe's
  normalized ingredient ids. Either coordinate with whoever holds BL-0018 or
  land the minimal `markCooked` mutation as the first changeset here.
- **On `markCooked`, step each normalized ingredient one notch:** `have → low`,
  `low → out`. Never below `out`. Coarse by design — increment 1 deliberately
  models `have | low | out`, never numeric quantities, and this must not
  reintroduce them.
- **Key on the same `canonicalItem`** the inflow loop and grocery list already
  use (the recipe-service normalization id), so a cooked recipe decrements
  exactly the pantry rows the shopping loop created.
- **Idempotency / double-cook:** marking the same recipe cooked twice must not
  double-step (a recipe cooked once shouldn't drive an item straight to `out`
  from `have`). Decide whether the step is per-cook or guarded by a cooked-log.

## Alternatives considered

- **Numeric quantity decrement** (subtract grams/counts) — more precise but
  drifts fast and the BL-0021 backlog warns against modeling exact quantities;
  rejected for the same reason increment 1 rejected it.
- **Building cook-decrement before the manual cycle** — increment 1 chose the
  manual have→low→out cycle first precisely so pantry state can move without
  this dependency; that ordering is already shipped.
