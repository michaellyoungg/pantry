---
id: BL-0062
title: Native home dashboard
status: in-progress
area: mobile
effort: M
related_specs: [2026-08-16-mobile-client-parity-design.md]
created: 2026-08-16
---

## Context

`/` is the state-aware "what do I do now?" surface built by BL-0017 — next
action, week strip, quick actions, and the getting-started path for empty
accounts.

On a phone it is the launch screen, so it carries more weight than it does on
the web, where a sidebar is always visible.

## Proposal

Port `Home` and its `home/` sub-components (`NextAction`, `WeekStrip`,
`QuickActions`, `GettingStarted`) to native views.

The state machine deciding *which* next action to show is derived logic and
belongs in `@pantry/core` or the `useHome()` hook, not in the view — it must not
be authored twice.

## Alternatives considered

- **Make the grocery list the launch screen and skip Home entirely.** Defensible
  for an in-store-only app, and it was the right call under the old subset plan.
  Wrong under a parity target, where the phone is the primary client.
