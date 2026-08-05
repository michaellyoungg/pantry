---
id: BL-0019
title: Grocery list UX — aisle sections, tap-to-check, recipe provenance, done-shopping
status: done
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

**Increment 2 (the rest of the proposal) — done.**

- **Collapsible aisle sections with counts.** `CollapsibleSection` wraps each
  aisle; the count lives on the header so a folded aisle still says how much of
  it is left. The header is the hit target, ≥44px, and the section is labelled
  by its own heading so it stays a landmark you can jump between.
- **"In cart" section.** Ticking a line holds it in the walk for the length of
  its leave animation and then re-partitions it into "In cart" (`partitionCart`
  in `@pantry/core`, with an `isInCart` predicate so the client can do exactly
  that). The top of the list is now only ever what is left.
- **"Done shopping" flow.** A sheet asks the one question that matters — keep
  what you didn't buy, or clear the list — and `groceryList.finishShopping`
  deletes accordingly. It deliberately writes nothing to the pantry: BL-0021
  already records inflow at check-off, so doing it again here would double it.
- **Swipe-away delete with undo.** `SwipeAwayRow` + `trackSwipe`; a left swipe
  past the commit distance removes the line. Every row it applies to also has a
  plain "Remove <item>" button, so the swipe is only ever an accelerator. Undo
  replays the line through `groceryList.restoreItem` rather than holding a
  pending delete in the component, which would die when the phone is pocketed.
- **One-handed ergonomics.** Add, the trip counter and "Done shopping" sit in a
  sticky bottom bar above the mobile nav; the add field folds behind one
  always-reachable control so the bar stays short.
- **Live household sync polish.** `presence.heartbeat`/`shoppers` (a
  `shoppingPresence` table with a TTL) drive "N others are on this list right
  now", and a remote change flashes the affected line. Changes you made
  yourself are registered before they land, so your own taps never flash.

The Playwright spec `apps/web/e2e/grocery-list-ux.spec.ts` covers the seams the
unit tests cannot: aisles built from the aggregator's real output, check-off
round-tripping through Convex, and "Done shopping" surviving a re-mount.

## Alternatives considered

- **Offline PWA now** — the biggest structural web weakness for in-store use, but larger
  scope; tracked as a vision item. Ship the presentation polish on the existing reactive
  list first.
- **Swipe-primary check-off** — worse discoverability and one-handed reliability than tap;
  keep swipe as a bonus.
