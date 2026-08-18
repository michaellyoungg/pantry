# Grocery pricing — increment 2: real store prices, opt-in, behind a flag

**Backlog item:** [BL-0046](../../backlog/BL-0046-kroger-real-store-prices.md)
**Date:** 2026-08-17
**Builds on:** [increment 1](2026-08-03-grocery-pricing-design.md), which shipped
the BLS national-average baseline. That baseline does not move; this layers on
top of it and falls back to it.

## Goal

For a user who chooses a store, replace as many guessed prices as possible with
that store's real shelf price — and change nothing at all for everyone else.

The whole design follows from one constraint: **the grocery list must never
break because a retailer's API is slow, rate-limited, misconfigured, or down.**
Real prices are an upgrade on a number the service can already produce offline
from a compiled-in table. Anything that cannot be upgraded is left as it was.

## Terms of use — what they permit, and what that forced

The backlog item asks for this first, and names it as a possible stop condition:
*"Read the terms first and record what they permit for caching and display — if
they forbid what this needs, say so and stop."*

The terms are at **<https://developer-ce.kroger.com/terms>**. They are
JS-rendered and did not load for any automated fetch attempted during design,
which is what an earlier draft of this document wrongly recorded as "could not
be verified" — they are readable in a browser, and the clause that governs this
design is:

> Scrape, build databases, or otherwise create permanent copies of such content,
> or keep cached copies longer than permitted by the cache header

That is a prohibited-use clause, and it is **not** a stop condition: it permits
caching, on terms. It does set two hard constraints, and the second of them
changed the design.

**Constraint 1 — no databases, no permanent copies.** The price cache is
in-process, unshared, and dies with the container. Nothing from the API is
written to Postgres or to Convex. What *is* persisted is the user's own choice
of store — a `locationId` and its name — which is their selection, not API
content. The 24-hour `maxCacheTTL` ceiling exists for this clause too: a
generous `max-age` should not become a permanent copy in all but name.

**Constraint 2 — cache lifetime comes from the cache header, not from us.** The
first version of this design cached each (store, ingredient) pair for a calendar
day, chosen because shelf prices move daily. That is not ours to choose. The
cache now reads `Cache-Control`/`Expires` off each products response and holds
the entry for exactly that long:

- `max-age` / `s-maxage` sets the window; `s-maxage` wins, because this cache is
  shared across every user of the process.
- `no-store`, `no-cache`, `private`, or `max-age=0` → **not cached at all**.
  `private` counts because a shared cache is what this is.
- No cache header, or an already-elapsed `Expires` → **not cached at all**. The
  conservative reading of "longer than permitted by the cache header" is that a
  header permitting nothing permits nothing.
- Whatever the header says, capped at 24 hours.

Not caching is always safe here: it costs calls against the daily budget, never
correctness. See the call-budget consequences in Decision 5.

**On display.** The clause quoted above governs copying and retention, not
display, and nothing found in the terms forbids showing a price to the user who
asked for it. The UI names the store the price came from and when it was
fetched, which is the honest presentation regardless.

**Still worth a human's eyes before enabling the flag anywhere:** the clause
above is the one that governs this design, but it is one clause of a longer
agreement, and the agreement is accepted at registration by whoever obtains the
credentials. That person should read the rest of it — particularly anything on
commercial use and attribution — before turning `PRICING_STORE_PROVIDER` on.

## Decision 1 — layer over the averages, never replace them

`Estimator.EstimateWithStore(lines, quotes)` walks the same lines as
`Estimate(lines)` and, per line, prefers a store quote when it has one that can
be converted honestly, and falls through to `estimateLine` — the increment-1
path, untouched — when it does not.

The fallback is **per line, not per request**. A store that priced 9 of 15 lines
produces a total covering all 15, and the UI says "9 of 15 priced at Corryville,
the rest from U.S. city average averages". The alternative — all-store or
all-average — would either put holes in the list or discard real prices because
one obscure ingredient was missing.

Two consequences worth naming:

- A store can price an ingredient **no BLS bucket covers** (sumac, gochujang).
  Bucket matching is not a precondition for a store price; it only supplies the
  optional density and per-item weight that bridge dimensions.
- A store quote that cannot be converted (a count of bacon against a mass-priced
  pack, with no per-item weight) falls back to the average rather than guessing.
  The average is coarse; a guess is wrong.

## Decision 2 — a store quote is shaped exactly like a BLS series

`StoreQuote` is `{cents, dimension, packSize}` — the same reduction `Series`
already is (`value`, `dimension`, `packSize`). Both divide to a price-per-base
unit, so the whole existing conversion machinery (`toSeriesBase`, the unit
table, the bucket bridges) works unchanged for both, and the two sources cannot
disagree about what "16 oz" means.

Getting a retailer's free-text pack size into that shape is the one genuinely
new parsing problem. `ParsePackSize` handles `1 gal`, `16 fl oz`, `12 ct`,
`5 lb`, `12 pk / 12 fl oz` — and **refuses everything else**, because the
fallback for a refusal is merely coarse while a misread pack size is
confidently wrong. `fl oz` is matched before `oz` deliberately: 16 fl oz and
16 oz differ by more than a factor of one.

## Decision 3 — the feature flag names the provider

`PRICING_STORE_PROVIDER=kroger` rather than a boolean. A second retailer later
is a new value and a new `StorePricer` implementation, not a second flag and a
precedence rule between them. Unset — the default — logs why and leaves the
route disabled.

Both the flag *and* credentials are required. Either alone leaves the pricer
nil, which is the same state as the feature not existing: `/pricing/stores`
answers an empty list, `/pricing/store-provider` answers `enabled: false`, and
`storeLocationId` on an estimate is ignored. Credentials are read from the
environment only; nothing here reads a file and nothing is compiled in.

## Decision 4 — opt-in is a stored store, in Convex

One `storeSelection` row per user, or none. None is the default and is what
makes this genuinely opt-in rather than opt-out.

It is a table rather than a field on `preferences` because it is not a food
preference: it is a per-provider handle whose meaning is owned by
recipe-service, it changes on a different cadence, and it must be deletable on
its own. It is a **query**, not a value threaded through the estimate, so the
web client re-prices reactively when the store changes.

The row stores the provider alongside the id. A selection outlives the
deployment that made it, and location id `01400376` means something else at a
different retailer — so `pricingEstimate` ignores a selection whose provider is
not the configured one, rather than pricing against it.

## Decision 5 — the call budget is spent per (store, ingredient), for as long as the cache header allows

Kroger's Products API allows ~10,000 calls/day. One product search per distinct
ingredient, per store, cached for exactly as long as that response permits:

- Lines sharing a normalized identity collapse to one lookup
  (`StoreQueries` dedupes), so a 30-line list with repeats is fewer than 30
  calls.
- **Misses are cached on the same terms.** An ingredient the catalogue does not
  carry is as much a property of that response as a price is, and re-asking
  inside the window would spend the budget learning the same thing repeatedly.
- A hard **30-lookup ceiling per list**, logged when hit rather than silently
  truncated — a silent truncation reads as "your store doesn't carry these".
- Lookups run six-at-a-time behind an 8-second whole-step deadline, so a cold
  list stays inside the request timeout.
- A 429 enters a cooldown (honouring `Retry-After`) during which nothing goes
  out and every line falls back to the average.

**The budget arithmetic depends on what Kroger's cache header actually says,
and that is worth measuring once the flag is on.** If products responses carry a
usable `max-age`, a store's common ingredients are fetched once per window and
steady-state traffic is small. If they carry no cache header — or `no-store` —
then nothing is cached, and each cold list view costs up to 30 calls: roughly
**330 list views per day** against the 10,000 limit before the rate limiter
starts answering, at which point every line falls back to the averages and the
list still renders. That ceiling is the honest cost of complying with the
caching clause rather than choosing our own TTL, and the 30-lookup-per-list cap
is what keeps a single request from spending the budget on its own.

The cache is in-process and unshared. A second replica repeats the first list of
each window; that is cheaper than the coordination a shared cache would need,
and a shared cache would also be much closer to the "database of content" the
terms prohibit.

## Degradation matrix

Every row produces the increment-1 estimate, and no row produces an error the
grocery list can see:

| Condition | Estimate | UI |
| --- | --- | --- |
| Flag unset | BLS averages | No store chooser at all |
| Flag set, credentials missing | BLS averages | No store chooser |
| Feature on, no store chosen | BLS averages | "Use my store's prices" |
| Retailer unreachable / 5xx | BLS averages | Unchanged; a warning is logged |
| Rate limited | BLS averages | Unchanged |
| Store carries nothing matched | BLS averages | Unchanged |
| Pack size unparsable | BLS average for that line | Mixed-source line |
| Partial match | Mixed | "9 of 15 priced at Corryville" |

The one place a failure is surfaced to the user is the **store search**, which
answers a deliberate action with its own screen: "could not look up stores" is
honest there, where an empty list would read as "no stores near you". It cannot
affect the bill.

## Testing

No test in the repo makes a live third-party call. `internal/kroger/testdata`
holds recorded response shapes — token, product search, a product with no price,
a product with marketing copy for a pack size, an empty result, a locations
search — served by `httptest`. Cache headers are test input rather than
scenery: `TestCacheTTL` covers the parsing directly, and
`TestQuoteDoesNotCacheWhatTheHeaderForbids` proves a response that permits no
caching is re-fetched every time and still returns its price. The suite runs with no credentials and no
network, which is also the only way CI can run it: the CI jobs have no Kroger
account.

## Out of scope

- **Mobile.** `apps/mobile` has no pricing surface at all yet; adding one is
  BL-0066's settings work, not this.
- **Sale-aware recommendations** — the `onSale` flag is now carried per line,
  which is the input BL-0047 needs, but nothing recommends from it here.
- **A shared/persistent price cache.** The terms prohibit building databases or
  permanent copies of API content, so a durable price store is not merely
  unnecessary — it is the thing the clause is about.
- **Aisle data.** The Products API returns `aisleLocations`, which would improve
  BL-0003's aisle ordering. It is a separate feature with a separate fallback
  story.
