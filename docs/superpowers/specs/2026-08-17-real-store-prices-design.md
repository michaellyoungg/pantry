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

## Terms of use — what is and isn't verified

The backlog item asks for this first, and names it as a possible stop condition:
*"Read the terms first and record what they permit for caching and display — if
they forbid what this needs, say so and stop."*

**Verified (2026-08-17):**

- The Products API's rate limit is **10,000 calls/day per client**, enforced per
  endpoint across all its operations. The Locations API is quoted at 1,600/day.
- Price data requires a `locationId` on the request. Without one the API returns
  products with no price at all, which is why real prices are inherently
  per-store and therefore inherently opt-in — there is no accidental-price path.

**NOT verified:** the text of Kroger's developer Terms of Service. Every
unauthenticated fetch of `developer.kroger.com` (and the `developer-ce` mirror)
timed out, the pages are JS-rendered, and the terms themselves sit behind
developer registration. This is the *same* obstacle BL-0023's research hit, and
the reason increment 1 chose BLS. Nothing found in search reproduces the terms'
wording on caching, storage, or display.

So the stop condition is **not** met — nothing was found that forbids this — but
neither was permission confirmed. The resolution is to make being wrong cheap
and to put the decision in front of the human who can actually make it:

- **The integration lands dark.** With `PRICING_STORE_PROVIDER` unset — the
  default, and what CI and every current deployment run — no code path here can
  reach Kroger, and the estimate is byte-for-byte the increment-1 estimate.
- **The operator who enables it is the party who accepted the terms.** Turning
  the flag on requires credentials, and obtaining credentials requires
  registering as a developer, which is where the terms are agreed. The person
  with the credentials is the person who read them.
- **Caching is conservative and legible.** Prices are held per (store,
  ingredient) for **one day** and never written to Postgres or Convex — the
  cache is in-process and dies with the container. If the terms turn out to
  forbid caching entirely, the fix is one constant; if they forbid displaying
  prices, the fix is not enabling the flag.
- **Provenance is always shown.** The UI names the store, the count of lines it
  priced, and that the rest are averages.

**This needs a human decision before the flag is turned on in any environment:**
someone with a Kroger developer account must read the terms and confirm what
they permit for caching and display. The code is written so that decision is a
config change, not a rewrite.

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

## Decision 5 — the call budget is spent per (store, ingredient, day)

Kroger's Products API allows ~10,000 calls/day. One product search per distinct
ingredient, cached for the calendar day, keyed by store:

- Lines sharing a normalized identity collapse to one lookup
  (`StoreQueries` dedupes), so a 30-line list with repeats is fewer than 30
  calls.
- **Misses are cached too.** An ingredient the catalogue does not carry is a
  stable fact for the day; re-asking would spend the budget learning it over
  and over.
- A hard **30-lookup ceiling per list**, logged when hit rather than silently
  truncated — a silent truncation reads as "your store doesn't carry these".
- Lookups run six-at-a-time behind an 8-second whole-step deadline, so a cold
  list stays inside the request timeout. After the first list of the day, the
  cache serves everything.
- A 429 enters a cooldown (honouring `Retry-After`) during which nothing goes
  out and every line falls back to the average.

The cache is in-process and unshared. A second replica repeats the first list of
the day; that is a handful of calls against a 10,000/day budget, and is much
cheaper than the coordination a shared cache would need.

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
search — served by `httptest`. The suite runs with no credentials and no
network, which is also the only way CI can run it: the CI jobs have no Kroger
account.

## Out of scope

- **Mobile.** `apps/mobile` has no pricing surface at all yet; adding one is
  BL-0066's settings work, not this.
- **Sale-aware recommendations** — the `onSale` flag is now carried per line,
  which is the input BL-0047 needs, but nothing recommends from it here.
- **A shared/persistent price cache.** In-process and per-day is enough for the
  budget; anything durable raises exactly the caching question the unread terms
  leave open.
- **Aisle data.** The Products API returns `aisleLocations`, which would improve
  BL-0003's aisle ordering. It is a separate feature with a separate fallback
  story.
