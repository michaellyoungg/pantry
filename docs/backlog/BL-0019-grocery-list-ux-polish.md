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

## Alternatives considered

- **Offline PWA now** — the biggest structural web weakness for in-store use, but larger
  scope; tracked as a vision item. Ship the presentation polish on the existing reactive
  list first.
- **Swipe-primary check-off** — worse discoverability and one-handed reliability than tap;
  keep swipe as a bonus.
