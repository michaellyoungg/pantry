---
id: BL-0017
title: Home dashboard — state-aware "what do I do now?" + shopping-day handoff
status: in-progress
area: web
effort: M
related_specs: [2026-07-12-full-app-ux-plan.md]
created: 2026-07-12
---

## Context

The busy-cook persona runs a weekly loop (plan → build list → shop → cook → repeat). The
research (IA + Cozi Today pattern) shows the highest-value cross-cutting surface is a Home
that resolves "what do I do now?" and carries the plan→shop handoff — not a marketing
dashboard. Depends on the routing/nav split (BL-0016).

## Proposal

A read-and-route Home (`/`) that never asks for detailed work:

- **This week's plan strip** — 7 compact day cells showing the planned dinner (or an empty
  "+ add"); tap a day → `/plan` focused there.
- **One state-aware primary CTA:** no plan → "Plan this week"; plan but no list → "Build
  grocery list (N items)"; list built → "Shopping day — N items ready → Shop" → `/list`
  shopping mode.
- **Shopping-day handoff card** — the single highest-value moment (couch → in-store phone);
  make it big and obvious.
- Quick actions row (Import recipe · Add a meal · Open list).
- New-user checklist (① Pick recipes ② Plan a week ③ Build your list) that disappears when
  complete.

## Alternatives considered

- **No home, land on Plan** — loses the shopping-day handoff and the state-aware "next step"
  that makes the four areas feel like one product.
- **Personalized/recommendations dashboard** — deferred to the vision layer (needs BL-0005
  signal); ship the state-aware version first.
