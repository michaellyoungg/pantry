# Grocery pricing — increment 1: the free estimated-cost baseline

**Backlog item:** [BL-0023](../../backlog/BL-0023-grocery-pricing-cost-estimation.md)
**Date:** 2026-08-03
**Scope:** increment 1 only. Increments 2 (Kroger real store prices) and 3
(sale-aware recommendations) are explicitly out of scope and are not designed
here beyond leaving room for them.

## Goal

Put an honest number on the grocery list: **"≈$47 this week"**, derived from free,
legally-clean US government average price data, keyed to the normalized
ingredient ids that BL-0003 already produces. Plus the same estimate for a single
recipe, so a plan card can show what a meal costs.

"Honest" is the load-bearing word. A national monthly average for *"Ground beef,
100% beef, per lb."* is not what the user's store charges for the 80/20 chub they
actually buy. The design's job is to be useful without pretending otherwise: show
the basis, show the vintage, and never silently invent a number for an ingredient
we cannot price.

## Data source

**BLS Average Price Data (AP)**, the CPI program's average retail price levels.

Verified during design (2026-08-03):

- `https://api.bls.gov/publicAPI/v2/timeseries/data/` answers **without a
  registration key**. A keyless POST for `APU0000708111` + `APU0000709112`
  returned `REQUEST_SUCCEEDED` with monthly values through **2026-06**.
- `https://download.bls.gov/pub/time.series/ap/ap.series` lists **64 active
  US-city-average (`area_code 0000`) series** whose `end_year >= 2026`. Eight are
  energy (gasoline ×4, diesel, fuel oil, electricity, piped gas), leaving
  **~56 food series** — the "~70–90 items" in the backlog item counts
  discontinued and regional series too.
- Series titles encode their pack unit deterministically: `per lb. (453.6 gm)`,
  `per doz.`, `per gal. (3.8 lit)`, `per 8 oz. (226.8 gm)`,
  `per 1/2 gal. (1.9 lit)`, `per 2 liters`. The refresher parses the unit from
  the title rather than requiring a hand-maintained unit column.
- Real data has real gaps: October 2025 values carry footnote code `X`,
  *"Data unavailable due to the 2025 lapse in appropriations"*, with `value: "-"`.
  The refresher must skip non-numeric values rather than parse them as zero.

**USDA ERS F-MAP** (regional adjustment) and **Food Price Outlook** (forecast
aging of a stale snapshot) are named in the backlog item. Both are **deferred**.
F-MAP is a downloadable dataset, not an API, and regional granularity is only
useful once we know the user's region — which we don't collect. Forecast aging is
a second data source and a model to defend; a monthly refresher solves staleness
more directly. Recorded here so the omission is a decision, not an oversight.

### Terms of use — what is and isn't verified

Raised explicitly because the backlog item asks for it:

- **Verified:** `https://www.bls.gov/robots.txt` disallows neither `/developers/`
  nor `/publicAPI/`. `download.bls.gov` and `api.bls.gov` both served requests
  carrying a descriptive, contactable User-Agent.
- **NOT verified:** the text of `https://www.bls.gov/developers/termsOfService.htm`
  and `api_faqs.htm`. Both return **HTTP 403** to every non-browser client tried
  (plain fetch and a browser User-Agent), so the actual ToS wording could not be
  read during design. The commonly-cited terms — public-domain data, ~25
  queries/day keyless, 500/day with a free key, 50 series per request — are
  **unconfirmed from the source** and are treated as *assumptions* below, not
  facts.

The design is therefore deliberately defensive, so that being wrong about the
unread terms is cheap:

- Attribution is carried in the data file and surfaced in the UI regardless of
  whether attribution is required.
- The refresher is **manual / occasional** (a CLI a human or a monthly CI job
  runs), not a runtime dependency. Serving traffic never calls BLS. Worst case we
  are one PR away from swapping the source out.
- No key is invented or committed. `BLS_API_KEY` is read from the environment if
  present and simply omitted otherwise.

**This needs a human decision before the source is relied on long-term:**
someone with a browser should read the ToS page and confirm the caching /
redistribution / attribution terms. Nothing in increment 1 blocks on it — a
checked-in snapshot of public-domain federal statistics is low-risk — but it
should not stay unread.

## Decision 1 — a module in recipe-service, not a new service

**Chosen: a self-contained Go package `apps/recipe-service/internal/pricing`,
exposed as one route on the existing recipe-service router.**

A separate deployable would cost a second Dockerfile, a docker-compose entry, a
second shared secret, a health check, a CI job, and a network hop — to serve a
table of ~56 numbers that changes once a month. That is not a service; it is a
lookup.

What keeps this from becoming the coupling the backlog item warns about:

- `internal/pricing` imports **nothing** from `internal/recipe`. Its input is
  plain `{canonicalItem, unit, quantity}` values — the normalized identity
  BL-0003 already emits — and its output is a plain estimate. It owns its own
  data files and its own unit table.
- The package boundary is drawn exactly where a future service boundary would
  be. Promoting it later means moving a directory and adding transport, not
  untangling it.
- The only shared surface is `internal/recipe/handler.go`, which gains **one
  route line** delegating to a new `handler_pricing.go`. That inherits the
  existing service-secret auth and OTel tracing for free rather than
  reimplementing them.

The unit table is duplicated (pricing needs `lb → g` whether or not `recipe`
exists). A test asserts pricing's factors agree with `normalization.json` for
every shared unit, so the duplication cannot silently drift.

*Rejected:* a `pricing-service` deployable (cost with no present benefit).
*Rejected:* computing prices in Convex from a TS-side snapshot (duplicates the
mapping in a second language, and Convex queries can't do the network I/O a
refresh needs).

## Decision 2 — the coarse-bucket → ingredient mapping

~56 BLS buckets must absorb an open-ended set of ingredient strings. Critically,
**`normalization.json` currently declares only 5 items**, so `canonicalItem` is
usually just lowercased free text — `"boneless skinless chicken breasts"`, not a
tidy enum. An exact-id dictionary would match almost nothing.

**Chosen: phrase matching, longest match wins.**

`pricing_map.json` keys each bucket to a BLS series and a list of match phrases:

```json
"chicken-breast": {
  "seriesId": "APU0000FF1101",
  "match": ["chicken breast", "boneless skinless chicken breast"],
  "exclude": ["broth", "stock", "bouillon"]
}
```

Resolution, given a lowercased ingredient string:

1. Discard any bucket whose `exclude` phrases appear in the string. This is what
   stops *"chicken broth"* from being priced as whole chicken and *"almond milk"*
   as dairy milk.
2. Among buckets with a whole-word phrase match, **the longest matching phrase
   wins.** `"ground beef"` beats `"beef"`; `"chicken breast"` beats `"chicken"`.
   Specificity falls out of phrase length rather than a hand-tuned priority list
   that rots as buckets are added.
3. Ties break on bucket key, lexicographically — so the result is deterministic
   and testable, never map-iteration-order dependent.
4. **No match → no estimate.** The line is counted as unpriced and reported.

*Rejected:* fuzzy / edit-distance matching. It converts "we can't price this"
into "here is a confidently wrong number", which is the exact failure this
feature must avoid.

## Decision 3 — units and dimensions

Each bucket declares a `dimension` (`mass`, `volume`, or `count`) and a price per
base unit (per gram / per ml / per each) derived from its BLS pack size. A
grocery line prices only when its unit can reach that dimension:

| Line unit | Bucket | Result |
|---|---|---|
| mass-convertible (`g`, `kg`, `oz`, `lb`) | `mass` | direct |
| volume-convertible (`ml`, `l`, `cup`, `tbsp`, `tsp`) | `volume` | direct |
| volume-convertible | `mass` + declared `gramsPerMl` | bridged via density |
| mass-convertible | `volume` + declared `gramsPerMl` | bridged via density |
| non-convertible / empty (a count) | `count` | direct |
| non-convertible / empty (a count) | `mass` + declared `gramsEach` | bridged |
| anything else | — | **unpriced** |

`gramsPerMl` and `gramsEach` are declared per bucket and only where the figure is
uncontroversial (flour ≈ 0.53 g/ml, granulated sugar ≈ 0.85, one large egg ≈ 50 g).
Where undeclared, the line goes unpriced rather than guessed. Density is the one
place this design accepts approximation, because without it every "2 cups flour"
in the app is unpriceable, and a cup of flour is a far better-known quantity than
a store's shelf price.

## Decision 4 — refresh cadence and staleness

BLS publishes AP monthly, roughly mid-month for the prior month. So a *perfectly*
refreshed snapshot is still 1–2 months old. Staleness is inherent, not a bug, and
the UI says so.

- **Seed:** `bls_snapshot.json`, checked in, embedded with `go:embed`. Serving a
  request never touches the network. Clone-and-run works offline with no key.
- **Refresh:** `cmd/pricing-refresh`, a CLI that fetches the mapped series,
  parses pack units from series titles, skips non-numeric values, and rewrites
  the snapshot. A human or a monthly CI job runs it; the change lands as a normal
  reviewable PR diff. It sends `BLS_API_KEY` if the env var is set and works
  without it.
- **Staleness is computed at request time** from the snapshot's
  `observationMonth` versus now — never baked into the file:
  - ≤ 3 months → `fresh`
  - 4–9 months → `aging`
  - \> 9 months → `stale`

The UI renders the basis inline, e.g.
`≈$47 · US average prices, Jun 2026 · 3 of 18 items not estimated`, and adds a
"prices may be out of date" hint at `stale`. The unpriced count is always shown
when non-zero: a total that quietly covers 11 of 18 items would be worse than no
total at all.

## Decision 5 — no `price` field, and no new Convex table

The backlog item is explicit that pricing must not be bolted onto the grocery
list model, and this design honours it: **the `groceryList` table is unchanged,
and `packages/convex/convex/schema.ts` is not touched at all.**

An estimate is a pure function of (lines, snapshot). Caching it in a
`priceEstimates` table would buy one avoided round trip in exchange for an
invalidation problem on every list edit, check-off, and regeneration. Not worth
it at this size.

Instead, two Convex **actions** in a new `pricing.ts`:

- `estimateGroceryList` — reads the user's list, drops lines flagged
  `alreadyHave` (the user isn't buying those), posts the rest to
  `POST /pricing/estimate`.
- `estimateRecipe` — aggregates one recipe via the existing `/grocery-list`
  endpoint, then prices the result. Per-recipe cost therefore reuses the exact
  aggregation semantics of the weekly list instead of a parallel code path.

The web side consumes `estimateGroceryList` through the existing `useAsyncData`
hook from BL-0012, which already models loading / data / error distinctly.

## Components

| Component | Responsibility | Depends on |
|---|---|---|
| `internal/pricing/snapshot.go` | load + validate embedded BLS snapshot | embedded JSON |
| `internal/pricing/mapping.go` | phrase match → bucket, longest wins | embedded JSON |
| `internal/pricing/estimate.go` | lines → total, per-line, unpriced counts | snapshot, mapping |
| `internal/pricing/staleness.go` | observation month + now → freshness | — |
| `cmd/pricing-refresh` | fetch BLS, rewrite snapshot | BLS API (offline path) |
| `internal/recipe/handler_pricing.go` | HTTP shim (auth + tracing inherited) | `internal/pricing` |
| `convex/pricing.ts` | two actions, no table | recipe-service |
| `web/components/PricingSummary.tsx` | the one honest line | `useAsyncData` |

`GroceryList.tsx` gains exactly one `<PricingSummary />` element plus its import —
other agents are editing that file concurrently.

## Error handling

Pricing is decoration, never a gate. Every failure mode degrades to "no estimate
shown", and none can break the grocery list:

- Unmappable ingredient → excluded from the total, counted in `unpricedCount`.
- Series missing from the snapshot (mapped but never fetched) → same.
- recipe-service unreachable / 5xx → `useAsyncData` surfaces an error in the
  summary line only; the list renders normally.
- Malformed snapshot at startup → the package fails loudly at load, matching how
  `normalization.json` already behaves. A corrupt price table should not boot.
- Empty list → no summary rendered at all.

Money is computed and returned in **integer cents** to avoid float drift, and
formatted once at the edge.

## Testing

- **Mapping:** longest-match wins; exclusions (`chicken broth` ≠ chicken,
  `almond milk` ≠ milk); unknown → no bucket; determinism on ties.
- **Estimate:** each dimension path in the table above; density and per-each
  bridges; unpriced counting; cents rounding; empty input.
- **Unit-table agreement:** pricing's factors match `normalization.json` for
  every shared unit — the anti-drift guard for Decision 1.
- **Snapshot integrity:** every series referenced by the mapping exists in the
  snapshot, every bucket has a dimension, prices are positive.
- **Staleness:** boundary months for fresh / aging / stale.
- **Handler:** happy path, auth rejection, malformed body.
- **Web:** `PricingSummary` renders total, unpriced count, stale hint, error, and
  renders nothing for an empty list.

## Out of scope

Increment 2 (Kroger, store selection, feature flag), increment 3 (sale-aware
planner scoring), regional adjustment, forecast aging, per-recipe cost *UI* on
plan cards (the API and Convex action are delivered; the card itself belongs to
files another agent is editing), and any price history or trend.
