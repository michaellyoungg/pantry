---
id: BL-0047
title: Sale-aware recommendations — plan the week around what's cheap right now
status: proposed
area: recommendations
effort: L
related_specs: [2026-07-12-full-app-ux-plan.md]
created: 2026-08-03
---

## Context

BL-0023 calls this **increment 3** and "the standout feature" of the pricing
work: once price and promo data exists, the app can stop merely *reporting* cost
and start *reducing* it — surfacing what is on sale and steering the week's plan
toward it.

BL-0023 shipped increment 1 (the BLS estimated-cost baseline) and is closed;
this item and BL-0046 carry the rest. It depends on real promo data, so
**BL-0046 (real store prices) lands first** — the BLS baseline is a monthly
national average and has no concept of a sale.

## Proposal

- **Surface the sale signal.** Given a user's store, identify which normalized
  ingredients are currently promo-priced and by how much against their usual
  price, so "cheap this week" is a computed delta rather than a raw price.
- **Feed it into recommendations (BL-0005) as a scoring dimension**, alongside
  the existing preference/pantry-intent signals — the same shape BL-0040 uses
  for nutrition targets. Cheapness is one weighted input, not an override: a
  recommendation the user won't cook is worthless however cheap it is.
- **Feed it into the planner (BL-0018)** as a "cook these this week, they're
  cheap right now" nudge on plan candidates, with the reason visible ("chicken
  thighs are 30% off at your store").
- **Show the reason, always.** A recommendation the user can't explain reads as
  arbitrary; the promo and its saving are the justification.
- **Degrade to silence.** With no store selected or no promo data, the feature
  simply doesn't appear — never a guessed or stale "sale".

## Alternatives considered

- **Rank purely by price** — produces a cheap, joyless, repetitive week and
  ignores everything the recommendation service already knows about the user.
  Cheapness belongs as one dimension among several.
- **Base sale detection on the BLS baseline** — the baseline is a national
  monthly average, so a "discount" against it measures regional price level, not
  a sale. It needs per-store regular-vs-promo pricing, hence the BL-0046
  dependency.
- **A standalone "deals" screen** — easy to build, easy to ignore. The value is
  in the plan itself being sale-aware at the moment the user is choosing meals.
