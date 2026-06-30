---
id: BL-0005
title: Recommendations / preference-lookup service
status: proposed
area: recommendations
effort: L
related_specs: [2026-06-29-recipe-to-grocery-list-design.md]
created: 2026-06-29
---

## Context

The core long-term goal is exploring fun recipes and doing recommendations —
"what should I make?" This is its own concern with its own data and likely its
own storage, distinct from the canonical recipe-service and the user-centric
Convex layer.

## Proposal

Stand up a recommendations / preference-lookup service that consumes user
preferences (from Convex) and recipe data (from recipe-service) to suggest
recipes. May own its own storage for derived data (embeddings, mappings,
interaction history) that neither Convex nor recipe-service needs to know about.

## Alternatives considered

- Bolt recommendations onto recipe-service — couples a heavy, evolving concern
  to the canonical store; keep separate per the multi-service intent.
- Pantry-driven suggestions ("cook from what's on hand") — related but a
  separate feature gated on a pantry/inventory subsystem (not yet backlogged as
  its own item; add when scoped).
