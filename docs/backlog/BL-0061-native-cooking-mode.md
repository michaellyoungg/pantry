---
id: BL-0061
title: Native cooking mode (recipe detail, steps, Before You Cook, prep)
status: proposed
area: mobile
effort: M
related_specs: [2026-08-16-mobile-client-parity-design.md]
created: 2026-08-16
---

## Context

First item of the parity phase, and the second place a phone genuinely beats a
laptop: propped against a mixing bowl with wet hands.

Covers the surfaces built by BL-0022 (steps), BL-0042 (prep rule engine),
BL-0044 (prep sources), and the Before You Cook flow.

## Proposal

Port recipe detail, step-by-step view, `BeforeYouCook`, prep task checkboxes,
and the prep-source badge to native views.

Native-specific concerns worth the effort here: keeping the screen awake while
cooking, large touch targets, and step text legible at arm's length. Prep task
checkboxes need optimistic updates — a controlled Convex checkbox without one
was already a source of test flake on the web side.

`DerivePrepTasks` is pure and lives server-side of the view layer already, so
this is views plus a `useRecipeDetail()` hook.

## Alternatives considered

- **Read-only recipe view without steps or prep.** Cheaper, but a recipe you
  cannot cook from is a listing, not a cooking mode, and the parity target
  includes it regardless.
