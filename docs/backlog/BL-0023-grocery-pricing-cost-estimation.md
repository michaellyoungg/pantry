---
id: BL-0023
title: Grocery pricing — cost estimation, then sale-aware meal recommendations
status: proposed
area: pricing
effort: L
related_specs: [2026-07-12-full-app-ux-plan.md]
created: 2026-07-12
---

## Context

Pantry already aggregates a basket/week plan into one normalized grocery list
(BL-0003 ingredient normalization + BL-0018 planner + BL-0019 list UX). The
natural next dimension on that list is **money**: "what will this cost?" and,
later, "what's cheap this week — plan around it?" Pricing is a distinct concern
with its own data sources, refresh cadence, storage, and legal constraints, so
it should be **its own element of the app** rather than a field bolted onto the
grocery list — the same reasoning that keeps recommendations (BL-0005) separate
from the canonical recipe-service.

Prior research (2026-07-12) into available price data landed three tiers:

- **Authoritative statistical averages** — free, legally clean, but coarse.
  - **BLS Average Price Data** (CPI program): the authoritative US source, ~70–90
    food items (eggs, ground beef, chicken breast, milk, bread…) as average
    retail *price levels*, national + some regional, monthly. Free **BLS Public
    Data API v2** (free registration key, 500 queries/day, 50 series/request).
    Series ids like `APU0000708111` (eggs), `APU0000709112` (milk).
  - **USDA ERS F-MAP**: monthly average unit prices + indexes for 90 food groups
    across 15 geographic areas — better regional granularity; downloadable
    datasets, not a live API. USDA **Food Price Outlook** gives forward
    inflation forecasts to age a cached baseline.
- **Retailer first-party APIs** — real, store-specific prices, access-gated.
  - **Kroger Products API**: free for registered devs, real regular + promo
    prices, availability, aisle; price requires a `locationId`; OAuth2
    client-credentials; 10,000 calls/day. The only realistically accessible
    *free real-price* retailer API. (Confirm ToS use restrictions before
    building — the terms page is JS-rendered and wasn't verifiable in research.)
  - Walmart (I/O / Marketplace) and Instacart exist but are affiliate/seller/
    partner-gated; **Target has no genuinely public price API.**
- **Third-party aggregators** — turnkey but constrained. **Spoonacular** gives
  per-recipe cost estimates cheaply, but its ToS forbids caching data > 1 hour —
  **incompatible** with storing price snapshots. Scraping services (Apify,
  Actowiz, etc.) carry ToS/legal + reliability risk; prototype-only.

## Proposal

Introduce **pricing as its own module/service seam**, delivered in increments so
the free, legally-clean baseline ships first and store-specific real prices layer
on top behind a flag.

- **Increment 1 — free estimated cost baseline.** Ingest **BLS average prices**
  (+ USDA F-MAP for regional adjustment) into a price table keyed to the
  normalized ingredient ids from BL-0003. Recipe-service (or a small pricing
  seam) owns the cached monthly table and refreshes it. Surface an **"estimated
  bill: ~$X/week"** line on the aggregated grocery list and per-recipe cost on
  plan cards. Honest about precision (generic item, monthly average, not your
  store). Zero cost, no per-store complexity, degrades gracefully — the right
  MVP.
- **Increment 2 — real store prices (opt-in).** For users who select a Kroger
  store `locationId`, upgrade estimates to actual shelf + promo prices via the
  **Kroger Products API**, behind a feature flag. Respect the 10k/day budget
  (batch by list, cache per store/day). Keep the BLS baseline as the fallback
  where a real price is unavailable.
- **Increment 3 — sale-aware recommendations.** Use promo/price data (Kroger
  promo prices; later other retailers) to **surface what's on sale and recommend
  the week's meals around cheap ingredients** — the standout feature. This is
  where pricing feeds the planner (BL-0018) and recommendations (BL-0005): a
  "cook these this week, they're cheap right now" nudge.

Design notes to settle in a spec: whether pricing is a new service vs. a module
in recipe-service; the ingredient-id → price-source mapping (BLS categories are
coarse, ~70–90 buckets, so map many normalized ingredients onto one bucket);
per-store cache/refresh strategy and staleness display; and how sale signals rank
into planner/recommendation scoring.

## Alternatives considered

- **Spoonacular for stored prices** — cheapest turnkey per-recipe cost, but the
  1-hour cache limit (and delete-on-termination clause) is incompatible with
  storing snapshots; rejected as the store of record.
- **Scrapers as a production dependency** — flexible multi-store coverage but
  ToS/legal + reliability risk; acceptable only for throwaway prototyping.
- **Start with real retailer prices** — skips the free baseline, forces every
  user through store selection + API-budget complexity, and offers nothing to
  users whose store isn't covered. Baseline-first degrades better.
- **Bolt a `price` field onto the grocery list** — couples an evolving,
  externally-sourced concern with its own refresh/legal constraints to the list
  UI; keep it a separate element per the multi-service intent.
