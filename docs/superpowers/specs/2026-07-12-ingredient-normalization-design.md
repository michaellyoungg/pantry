# Ingredient normalization + unit conversion + aisle grouping

Backlog: [BL-0003](../../backlog/BL-0003-ingredient-normalization.md) · Area:
grocery-list · Effort: L

## Problem

`Aggregate` in recipe-service combines grocery lines by **literal exact-match**
on `(item, unit)` (trimmed, lowercased). That leaves obvious wins on the table:

- **Synonyms stay split.** "garlic" vs "garlic cloves" vs "fresh garlic" are
  three lines.
- **Compatible units don't combine.** `4 tbsp` and `0.5 cup` of butter stay
  separate instead of totalling `0.75 cup`.
- **No shopping structure.** The list is flat; related items (produce, dairy)
  aren't grouped.
- **Display rough edges** (surfaced in Plan 1 review): the normalized match key
  becomes the display text, so "Garlic" shows as `garlic`; and `float64` sums
  surface noise like `0.1 + 0.2 = 0.30000000000000004`.

## Goals

Add an **aggregate-time** normalization layer in recipe-service (the canonical
owner of ingredient data and aggregation) that:

1. Resolves item synonyms to a canonical item.
2. Converts and combines compatible units, displaying the total in a friendly
   unit.
3. Tags each line with a grocery aisle and returns lines grouped by aisle.
4. Preserves sensible display casing and formats quantities as nice fractions.

Normalization happens at aggregate-time, **not** write-time: stored recipes stay
faithful to their source (this matters more once free-text URL import, BL-0001,
lands).

## Non-goals

- Per-item preferred display units.
- Metric-vs-US / internationalized unit preferences (display ladders are
  US-cooking-oriented: volume in cup/tbsp/tsp, mass in kg/g).
- Exhaustive dictionaries. Unknown items and units are first-class: they pass
  through unchanged and land in the "other" aisle.

Fraction-formatted display **is** in scope (`¾ cup`, not `0.75 cup` or
`12 tbsp`) — without it the "friendly unit" choice can't be made well (see
[Friendly units](#friendly-units-fraction-aware)).

## Architecture

A single embedded data table plus a small `normalize` module, called from a
rewritten `Aggregate`. This mirrors the existing embedded-`catalog.json`
convention and keeps all combining logic in one testable place.

### Data file: `internal/recipe/normalization.json`

Embedded with `//go:embed`, like `catalog.json`. Three lookup sections plus a
canonical aisle order:

```jsonc
{
  "units": {
    "tsp":  { "dimension": "volume", "toBase": 4.92892,  "display": true },
    "tbsp": { "dimension": "volume", "toBase": 14.7868,  "display": true },
    "cup":  { "dimension": "volume", "toBase": 236.588,  "display": true },
    "ml":   { "dimension": "volume", "toBase": 1 },
    "l":    { "dimension": "volume", "toBase": 1000 },
    "g":    { "dimension": "mass",   "toBase": 1,    "display": true },
    "kg":   { "dimension": "mass",   "toBase": 1000, "display": true },
    "oz":   { "dimension": "mass",   "toBase": 28.3495 },
    "lb":   { "dimension": "mass",   "toBase": 453.592 }
  },
  "synonyms": {
    "garlic cloves": "garlic",
    "fresh garlic":  "garlic",
    "scallions":     "green onion"
  },
  "items": {
    "garlic": { "display": "Garlic", "aisle": "produce" },
    "butter": { "display": "Butter", "aisle": "dairy" }
  },
  "aisleOrder": ["produce", "meat", "dairy", "bakery", "pantry", "frozen", "other"]
}
```

- `units` — only convertible units appear here, each with its dimension and a
  factor to that dimension's base unit (volume base = ml, mass base = g).
  `display: true` marks a unit eligible for friendly output.
- `synonyms` — alias (normalized) → canonical item key.
- `items` — canonical item key → `{ display, aisle }`.
- `aisleOrder` — shopping-flow order; drives line sorting and, downstream,
  section order. `"other"` is the fallback aisle and sorts last.

The seed dictionaries start small and grow; they are data, not code.

### `normalize.go`

A `Normalizer` loaded once from the embedded JSON (fail fast on parse error at
startup, same as catalog loading), exposing pure methods:

- `CanonicalItem(raw string) → (canonical, display, aisle string)`
  - Normalize: `strings.ToLower(strings.TrimSpace(raw))`.
  - Resolve `synonyms[normalized]` if present.
  - Look up `items[canonical]`: use its `display` and `aisle`.
  - **Unknown item fallback:** `canonical = normalized`, `display =` the
    *first-seen original* casing (trimmed, not lowercased), `aisle = "other"`.

- `Unit(raw string) → (dimension string, toBase float64, ok bool)`
  - Look up the normalized unit in `units`. `ok = false` for anything absent
    (`""`, `clove`, `pinch`, `can`, `slice`, …) → non-convertible.

- <a id="friendly-units-fraction-aware"></a>`Friendly(dimension string, baseQty
  float64) → (qty float64, unit string)` — fraction-aware unit selection.

  The display units of a dimension form a ladder ordered by size, e.g. volume
  `[tsp, tbsp, cup]`, mass `[g, kg]` (derived from `display: true` entries). The
  goal: show the amount in the **largest** unit where it reads cleanly, so
  `12 tbsp → ¾ cup` but `2 tsp` stays `2 tsp` (not `⅔ tbsp`).

  Nice values = a whole number, or a whole plus one of `{¼, ⅓, ½, ⅔, ¾}`
  (match within ε = 0.02).

  Walk the ladder from the smallest display unit upward. Let `q0` be the count in
  the current unit. Step up to the next-larger unit (giving `q1`) only if:
  - `q1 ≥ 1` (the amount is at least a whole in the larger unit), **or**
  - `q1` snaps to a nice fraction in `[¼, 1)` **and** `q0 ≥ 4` (the amount is
    bulky in the smaller unit — 12 tbsp is bulky, 2 tsp is not).

  Keep stepping while the condition holds. `qty = snapNice(baseQty / toBase)` of
  the chosen unit; if the chosen unit is the smallest and the value isn't nice,
  fall back to a 2-decimal round. The bulk threshold `4` is a named constant.

  Worked results: `12 tbsp → ¾ cup`; `3 tsp → 1 tbsp`; `2 tsp → 2 tsp`;
  `4 tbsp → ¼ cup`; `250 g + 0.5 kg → ¾ kg`; `200 g → 200 g`.

- `snapNice(f) → float64` — snap to the nearest nice value within ε (fixing
  float-sum noise like `0.1 + 0.2`), else round to 2 decimals. Returns a plain
  `float64`; rendering the number as a glyph (`0.75 → ¾`) is a **web** concern
  (see [Web](#web)), keeping the wire type numeric.

### Rewritten `Aggregate`

Two key types drive the sum:

- **Convertible** (`Unit` returns `ok`): key `(canonicalItem, dimension)`.
  Accumulate `quantity × toBase` in base units. Emit via `Friendly`.
- **Non-convertible**: key `(canonicalItem, normalizedUnit)`. Sum raw
  `quantity`. Emit `unit = normalizedUnit`, `quantity = snapNice(sum)`.

Consequences:

- `2 clove garlic` + `1 tbsp minced garlic` → **two** lines (a count and a
  volume of the same item can't be merged). Correct.
- `4 tbsp butter` + `0.5 cup butter` → `¾ cup Butter` (12 tbsp = 177.44 ml; the
  amount is bulky in tbsp so it promotes to the nice fraction ¾ cup).
- Summing happens in base units and the total is `snapNice`-d, so float
  artifacts (`0.1 + 0.2 = 0.30000000000000004`) never reach the display; a total
  that isn't a nice fraction falls back to a clean 2-decimal number.

Each emitted line carries its `aisle` and `display` item text. Lines are
returned **sorted by `(aisleOrder index, first-seen order)`** — so a grouped
renderer can just walk consecutive same-aisle lines. First-seen order is
preserved within an aisle for determinism (aligns with today's insertion-order
behavior).

## Data flow / downstream changes

`GroceryLine` gains an `aisle` field, carried end to end.

### Types

`@pantry/types` `GroceryLine` and the Go `GroceryLine` both add `aisle`:

```go
type GroceryLine struct {
    Item     string  `json:"item"`
    Unit     string  `json:"unit"`
    Quantity float64 `json:"quantity"`
    Aisle    string  `json:"aisle"`
}
```

### Convex

`groceryList` table adds `aisle: v.string()`. `replaceGroceryList` passes it
through from the fetched lines; `generateGroceryList` needs no logic change (it
already forwards recipe-service output verbatim). No migration required — the
list is fully replaced on each generate.

### Web

<a id="web"></a>Two changes, both presentational:

- **Fraction formatting.** A small pure util `formatQuantity(n: number): string`
  maps recognized nice values to glyphs — `0.75 → "¾"`, `1.5 → "1½"`,
  `0.333… → "⅓"` — matching within ε and rendering the whole part as a prefix;
  any other value falls back to a trimmed 2-decimal string (`0.3 → "0.3"`). This
  mirrors recipe-service's nice-value set so the unit choice and the glyph agree.
  The quantity stays a `number` on the wire and in Convex; only the rendered
  text changes.
- **Grouped sections.** `GroceryList.tsx` partitions lines by `aisle` and renders
  a title-cased section header per aisle in arrival order (recipe-service
  pre-sorts), items under each header, each quantity run through
  `formatQuantity`. Per-line check-off behavior is unchanged; grouping and
  formatting are purely presentational. The empty-list state is unchanged.

## Edge cases

- **Unknown item** → passes through with first-seen casing, aisle `"other"`.
- **Unknown / empty unit** → non-convertible; combines only on exact unit match.
- **Mixed dimensions for one item** → stay separate lines (see above).
- **Zero / negative quantity** → summed as-is (no special handling).
- **Ingredient note** → already dropped by aggregation today; unchanged.

## Testing

- `normalize_test.go` — table-driven: synonym resolution; unknown pass-through
  (casing + `other` aisle); unit conversion math; `Friendly` fraction-aware
  selection incl. the `12 tbsp → ¾ cup` / `2 tsp stays 2 tsp` / `3 tsp → 1 tbsp`
  boundary cases; `snapNice` (nice-value snapping + float-noise + 2-dp fallback).
- `aggregate_test.go` — extend: synonyms merge across recipes; convertible units
  combine with friendly fractional display; non-convertible stay separate; mixed
  dimensions for one item stay separate; aisle assignment and sort order; the
  float-noise sum case.
- `handler_test.go` — `/grocery-list` response now includes `aisle`.
- `formatQuantity` unit test (web) — glyph mapping for `¼ ⅓ ½ ⅔ ¾`, mixed
  numbers (`1½`), and 2-decimal fallback for non-nice values.
- `GroceryList.test.tsx` — renders aisle section headers and groups lines under
  them; unknown items appear under "Other"; quantities show as fraction glyphs.