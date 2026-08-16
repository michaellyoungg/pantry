---
id: BL-0066
title: Native settings and preferences (taste, avoid list, equipment, household)
status: proposed
area: mobile
effort: M
related_specs: [2026-08-16-mobile-client-parity-design.md]
created: 2026-08-16
---

## Context

`/settings` collects taste preferences, the avoid list with allergen families
(BL-0052), equipment inventory (BL-0043), household size, and nutrition target
selection.

Low value on a phone — these are set-once screens — but they are the inputs the
recommendation engine reads, so an account configured only on the web and never
inspectable on the phone is a confusing product.

## Proposal

Port the settings surfaces to native views: `Preferences`, `TastePreferences`,
`EquipmentEditor`, `HouseholdSize`, and target selection.

Mostly forms and toggles, which is exactly where the platform-portable
primitives from BL-0026 pay off — `useConfirm()` keeps its call sites and gets
an `Alert`-backed implementation natively.

## Alternatives considered

- **Leave settings web-only permanently.** Together with History, the strongest
  candidate for permanent partial parity: rarely touched, form-heavy, and
  perfectly usable in the phone's browser. Worth revisiting before starting this
  item.
