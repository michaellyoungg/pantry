---
id: BL-0058
title: Offline grocery cache + collapse-and-replay reconciliation
status: done
area: mobile
effort: L
related_specs: [2026-08-16-mobile-client-parity-design.md]
created: 2026-08-16
---

## Context

Shops have bad signal. An in-store companion that stops working in the freezer
aisle is not a companion. This is the riskiest feature in the mobile plan: done
wrong it corrupts pantry data rather than merely losing a tap.

`2026-07-18-mobile-client-design.md` rule 6 claimed check-off "is already a
boolean keyed on `item|unit|aisle`, which is exactly why offline is cheap here."
That is **no longer accurate**. BL-0021 and BL-0032 changed `toggleItem`
(`packages/convex/convex/groceryList.ts:176`):

- It is keyed on `v.id("groceryList")` — a Convex **document id**, not the
  composite. Regeneration deletes and re-inserts rows, so a queued offline
  check-off holding a stale `_id` fails with `Not found` on replay.
- Checking off writes **pantry inflow** via `upsertFromCheckoff`; unchecking
  calls `removeAutoRow` and clears `leftoverDecision`. It has cross-table side
  effects.

What *is* settled: `mergeGroceryList` preserves `checked` across regeneration
(`groceryList.test.ts:103`) and flags rather than deletes a checked line the
plan no longer wants (`:206`). That was the open risk in the 2026-07-18 design
and it is now proven.

## Proposal

Persist the grocery list and pending check-offs durably on device; reconcile on
reconnect.

**Replay the final intended state per line, not the event log.** Collapse the
offline queue to one desired `checked` value per `item|unit|aisle` composite
key, re-resolve that key to the current document id at replay time, and issue
one `toggleItem` per line.

This is idempotent and order-independent, and it gets the pantry side effects
right, because `upsertFromCheckoff` and `removeAutoRow` are themselves
upsert/remove semantics — the final state converges. A naive mutation queue
replaying every tap in order would corrupt the don't-rebuy signal BL-0021 built.

**Unresolvable case, which must not be swallowed:** a line checked offline that
the server hard-deleted during a regeneration performed before it ever heard
about the check-off. Replay finds no row. Dropping it silently loses a real
purchase *and* its pantry inflow, so surface it as a small conflict prompt.

Offline scope stays the grocery list only. Nothing else in the app gets a local
source of truth.

## Alternatives considered

- **Naive pending-mutation queue replayed in order.** The obvious design, and
  wrong here — stale document ids fail outright, and replaying every tap drives
  the pantry through intermediate states.
- **Offline-first across the whole app.** Requires a local source of truth and a
  sync engine, fighting Convex's model rather than using it; plausibly larger
  than the rest of the native client combined.
- **Read-only offline (view the list, queue nothing).** Much cheaper and removes
  all reconciliation risk, but check-off *is* the in-store interaction, so this
  fails the use case.
