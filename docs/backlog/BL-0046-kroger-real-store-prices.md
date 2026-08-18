---
id: BL-0046
title: Real store prices (opt-in) — Kroger Products API behind a feature flag
status: done
area: pricing
effort: M
related_specs: [2026-07-12-full-app-ux-plan.md, 2026-08-17-real-store-prices-design.md]
created: 2026-08-03
---

## Context

BL-0023 delivered **increment 1 only**: a free, legally-clean estimated-cost
baseline from BLS average price data, keyed to the normalized ingredient ids
from BL-0003 and surfaced as an "estimated bill" on the grocery list. That is
deliberately coarse — a national monthly average for a generic item, not the
price at the user's store.

BL-0023's proposal names **increment 2** as real store prices, and it is split
out here so the shipped baseline can be closed out on its own (the same way
BL-0021 spun its remaining increments into BL-0028 / BL-0029).

## Proposal

- **Kroger Products API as the first real-price source.** Free for registered
  developers, OAuth2 client-credentials, ~10,000 calls/day, returns regular +
  promo price, availability and aisle. Price requires a store `locationId`, so
  it is inherently opt-in per user.
- **Opt-in store selection.** The user picks a Kroger `locationId` (store
  search by zip); with no store selected, nothing changes and the BLS baseline
  stands.
- **Behind a feature flag**, so the integration can land dark and be enabled
  per environment.
- **BLS baseline stays the fallback.** Any ingredient with no matched product,
  no price for that location, or a stale/failed fetch falls back to the
  estimate rather than dropping the line — the list must never show a hole.
- **Respect the call budget**: batch lookups per grocery list, cache per
  (store, day), and display staleness honestly.
- **Confirm the ToS before building.** BL-0023's research flagged that Kroger's
  developer terms page is JS-rendered and could not be verified; increment 1
  chose BLS partly for that reason. Read the terms first and record what they
  permit for caching and display — if they forbid what this needs, say so and
  stop.

## Alternatives considered

- **Walmart / Instacart / Target** — affiliate-, seller-, or partner-gated, or
  (Target) no genuinely public price API at all. Kroger is the only realistically
  accessible free real-price retailer API.
- **Scraping retailer sites** — broader store coverage, but ToS/legal and
  reliability risk; prototype-only, not a production dependency.
- **Replacing the BLS baseline outright** — leaves every user whose store isn't
  covered with nothing. Layering keeps graceful degradation.
