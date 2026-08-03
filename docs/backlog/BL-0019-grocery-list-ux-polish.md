---
id: BL-0019
title: Grocery list UX — aisle sections, tap-to-check, recipe provenance, done-shopping
status: in-progress
area: grocery-list
effort: L
related_specs: [2026-07-12-full-app-ux-plan.md]
created: 2026-07-12
---

## Context

The aggregated list already normalizes ingredients, converts units, groups by aisle, and
retains source-recipe entries (BL-0003, done), and Convex gives real-time sync for free. The
competitive gap is entirely presentation — the current `GroceryList` is a flat checklist.
Optimized for one-handed in-store phone use.

## Proposal

- **Aisle sections** (from the Go aggregator's existing aisle output), collapsible, with
  counts.
- **Tap-to-check is primary:** strikethrough + dim + animate into a collapsible "In cart"
  section so the top is always "what's left." Swipe = accelerator only (swipe-away delete
  with undo), never the sole path.
- **Recipe provenance:** each aggregated line shows "N recipes"; a detail sheet lists
  contributing recipes + amounts, each tappable to the recipe.
- **One-handed ergonomics:** add / check / "Done" in the bottom thumb zone; ≥44px targets.
- **Manual add** with recent/favorite chips + auto-categorization into an aisle.
- **"Done shopping" flow:** remove-purchased vs keep-unbought (and, once pantry lands, add
  purchased to pantry).
- **Live household sync polish:** presence + highlight on remote change (Convex — nearly
  free).

## Progress

**Increment 1 (provenance + manual add) — done.** The aggregator now retains
which recipes each line came from and how much each wanted; the line shows
"N recipes" and a sheet lists them, each linking through to `/recipes?recipe=<id>`.
Manual add takes one typed field ("2 lb butter"), categorised server-side from
recipe-service's normalization table, with recent-item chips drawn from the
pantry. Manual lines survive re-generation; only they can be removed.

Note for whoever picks this up next: an earlier PR titled "BL-0019: Grocery list
UX polish" (#38) was the *claim* commit — it changed only the two backlog files.
Nothing from the proposal had shipped before the increment above.

**Remaining**, roughly in value order:

- **Collapsible aisle sections with counts** — sections render, but they are
  plain headings; nothing collapses.
- **"In cart" section** — checked lines strike through in place today; they do
  not animate out into a separate section, so the top of the list is not yet
  "what's left".
- **"Done shopping" flow** — remove-purchased vs keep-unbought. Not started.
- **Swipe-away delete with undo** — the accelerator half of the interaction.
  Tap-to-check is in place and remains primary.
- **One-handed ergonomics** — new controls are ≥44px, but add/check/"Done" are
  not yet gathered into the bottom thumb zone.
- **Live household sync polish** — presence + highlight on remote change. The
  list is already reactive; this is the visible acknowledgement of a remote edit.

## Alternatives considered

- **Offline PWA now** — the biggest structural web weakness for in-store use, but larger
  scope; tracked as a vision item. Ship the presentation polish on the existing reactive
  list first.
- **Swipe-primary check-off** — worse discoverability and one-handed reliability than tap;
  keep swipe as a bonus.
