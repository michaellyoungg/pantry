---
id: BL-0040
title: Nutrition-aware recommendations — targets as a scoring dimension
status: proposed
area: recommendations
effort: M
related_specs: [2026-08-03-nutrition-system-design.md]
created: 2026-08-03
---

## Context

The payoff for keeping the nutrition module emit-only. Once recipes carry a
nutrient vector (BL-0036) and users carry declarative targets (BL-0038), the
recommender can answer *"suggest meals that fit what's left of my week"* —
without the nutrition module knowing the recommender exists.

BL-0005 (recommendations) and BL-0033 ("suggest my week", set-level plan
optimization) are being designed in parallel and already establish a
candidate-generation and scoring architecture. Nutrition should arrive there as
**one more scoring input**, alongside pantry-intent and — later — the sale-aware
pricing signal from BL-0023. This is the same composition story pricing tells,
which is why neither should own the scorer.

Depends on **BL-0038** and on BL-0005's scoring seam existing.

## Proposal

- A scoring contribution: given a candidate recipe's per-serving vector, the
  user's active targets, and what the plan already commits, score how well the
  candidate closes the remaining gap.
- Two distinct uses, both falling out of the same score:
  - **Filtering** — hard constraints ("nothing over 200mg cholesterol") remove
    candidates.
  - **Ranking** — soft goals ("more protein") reorder them.
  The operator on a target does not decide this; whether the user marks a target
  as a hard constraint does. That flag is the only addition to `nutritionTargets`.
- Set-level fit for BL-0033: a *week* can hit a protein target even when
  individual nights do not, so scoring at the plan level beats scoring each
  recipe in isolation.
- Candidates with unknown or low-coverage nutrition are **ranked neutrally, not
  penalized** — a recipe should not be buried for being unmapped, and it must not
  be recommended as though it satisfies a hard constraint it was never checked
  against.

## Alternatives considered

- **A dedicated "nutrition recommendations" surface** separate from BL-0005.
  Ships sooner and is independently testable, but it splits recommendation logic
  across two systems and gives the user two places to look for suggestions.
- **Nutrition subscribing to the planner** to push suggestions. Inverts the
  dependency the design deliberately established (§ "Nutrition emits; it never
  subscribes") and couples a food-knowledge module to a UI surface.
- **LLM-generated nutrition-aware suggestions** (via BL-0034's candidate
  provider). Strong for open-ended requests and worth composing with later, but
  it should rank *deterministically scored* candidates rather than replace the
  scorer — the numbers are the part the user is trusting.
