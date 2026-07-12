# Ingredient Normalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aggregate grocery lines smarter — merge ingredient synonyms, combine compatible units into a friendly fractional display, and group the list by grocery aisle.

**Architecture:** Add an aggregate-time normalization layer in recipe-service driven by an embedded `normalization.json` (synonyms, convertible units, item→aisle, aisle order) and a pure `normalize.go` module. `Aggregate` is rewritten to canonicalize items, sum convertible units in a base unit and emit a friendly unit, and tag each line with an aisle. The new `aisle` field flows through `GroceryLine` → `@pantry/types` → Convex `groceryList` → a grouped, fraction-formatted `GroceryList.tsx`.

**Tech Stack:** Go (recipe-service, `//go:embed`, `testing`), TypeScript (`@pantry/types`), Convex (`v.object` validators), React + Vitest + Testing Library (web).

## Global Constraints

- Normalization happens **at aggregate-time**, never at write-time. Stored recipes stay byte-faithful to their source. Only `Aggregate` normalizes.
- Unknown items/units are **first-class**: unknown item → canonical = normalized text, display = first-seen original (trimmed) casing, aisle = `"other"`; unknown unit → non-convertible (combines only on exact unit match).
- The wire quantity stays a numeric `float64` / `number` end to end. Rendering a number as a fraction glyph (`0.75 → ¾`) is a **web presentation** concern only.
- Nice-value set (shared by Go `Friendly`/`snapNice` and web `formatQuantity`): a whole number, or a whole plus one of `{¼=0.25, ⅓, ½=0.5, ⅔, ¾=0.75}`. Match within **ε = 0.02**.
- Unit base factors (exact, copy verbatim): `tsp=4.92892`, `tbsp=14.7868`, `cup=236.588`, `ml=1`, `l=1000` (volume, base ml); `g=1`, `kg=1000`, `oz=28.3495`, `lb=453.592` (mass, base g).
- Bulk-promotion threshold constant = `4` (a smaller-unit count ≥ 4 may promote to a larger unit that lands on a nice fraction).
- Aisle order (copy verbatim): `["produce", "meat", "dairy", "bakery", "pantry", "frozen", "other"]`. `"other"` is the fallback and sorts last.
- Follow existing repo test style: Go table/`reflect.DeepEqual` tests in `package recipe`; web tests with the hoisted `convex/react` mock pattern already in `GroceryList.test.tsx`.

## File Structure

**recipe-service (`apps/recipe-service/internal/recipe/`)**
- Create `normalization.json` — the embedded data table (units, synonyms, items, aisleOrder).
- Create `normalize.go` — `Normalizer` (load + `CanonicalItem` / `Unit` / `Friendly`) and `snapNice` / `niceValue` helpers.
- Create `normalize_test.go` — unit tests for the module.
- Modify `types.go` — add `Aisle` to `GroceryLine`.
- Modify `aggregate.go` — rewrite `Aggregate` to use the `Normalizer`.
- Modify `aggregate_test.go` — update expectations for canonicalization/aisle/sort.
- Modify `handler_test.go:152` — grocery-list response now carries `aisle`.

**shared types + convex (`packages/`)**
- Modify `packages/types/src/index.ts` — add `aisle: string` to `GroceryLine`.
- Modify `packages/convex/convex/groceryList.ts` — `aisle` in `groceryLineValidator` + `replaceGroceryList` insert.
- Modify `packages/convex/convex/schema.ts` — `aisle: v.string()` on `groceryList`.

**web (`apps/web/src/`)**
- Create `lib/formatQuantity.ts` — number → fraction-glyph string.
- Create `lib/formatQuantity.test.ts` — its tests.
- Modify `components/GroceryList.tsx` — grouped-by-aisle sections + `formatQuantity`.
- Modify `components/GroceryList.test.tsx` — aisle on fixtures + grouping/glyph tests.

---

### Task 1: Normalization data + item/unit lookup

**Files:**
- Create: `apps/recipe-service/internal/recipe/normalization.json`
- Create: `apps/recipe-service/internal/recipe/normalize.go`
- Test: `apps/recipe-service/internal/recipe/normalize_test.go`

**Interfaces:**
- Produces: package var `normalizer *Normalizer`; methods `func (n *Normalizer) CanonicalItem(raw string) (canonical, display, aisle string)`, `func (n *Normalizer) Unit(raw string) (dimension string, toBase float64, ok bool)`, `func (n *Normalizer) aisleRank(aisle string) int`; `func loadNormalizer(raw []byte) (*Normalizer, error)`.

- [ ] **Step 1: Create the data file**

Create `apps/recipe-service/internal/recipe/normalization.json`:

```json
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
    "fresh garlic": "garlic",
    "scallions": "green onion"
  },
  "items": {
    "garlic":      { "display": "Garlic",      "aisle": "produce" },
    "green onion": { "display": "Green onion", "aisle": "produce" },
    "flour":       { "display": "Flour",       "aisle": "pantry" },
    "butter":      { "display": "Butter",      "aisle": "dairy" },
    "milk":        { "display": "Milk",        "aisle": "dairy" }
  },
  "aisleOrder": ["produce", "meat", "dairy", "bakery", "pantry", "frozen", "other"]
}
```

- [ ] **Step 2: Write the failing test**

Create `apps/recipe-service/internal/recipe/normalize_test.go`:

```go
package recipe

import "testing"

func TestCanonicalItem_KnownSynonymResolvesToDisplayAndAisle(t *testing.T) {
	canon, display, aisle := normalizer.CanonicalItem(" Garlic Cloves ")
	if canon != "garlic" || display != "Garlic" || aisle != "produce" {
		t.Fatalf("got (%q,%q,%q), want (garlic,Garlic,produce)", canon, display, aisle)
	}
}

func TestCanonicalItem_UnknownPassesThroughWithFirstSeenCasing(t *testing.T) {
	canon, display, aisle := normalizer.CanonicalItem(" Sriracha ")
	if canon != "sriracha" || display != "Sriracha" || aisle != "other" {
		t.Fatalf("got (%q,%q,%q), want (sriracha,Sriracha,other)", canon, display, aisle)
	}
}

func TestUnit_ConvertibleAndNot(t *testing.T) {
	if dim, toBase, ok := normalizer.Unit("Cup"); !ok || dim != "volume" || toBase != 236.588 {
		t.Fatalf("cup: got (%q,%v,%v)", dim, toBase, ok)
	}
	if _, _, ok := normalizer.Unit("cloves"); ok {
		t.Fatal("cloves should be non-convertible")
	}
}

func TestLoadNormalizer_RejectsBadJSON(t *testing.T) {
	if _, err := loadNormalizer([]byte("{not json")); err == nil {
		t.Fatal("expected error on malformed json")
	}
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/recipe-service && go test ./internal/recipe/ -run 'CanonicalItem|Unit_Convertible|LoadNormalizer' -v`
Expected: FAIL — `undefined: normalizer` / `loadNormalizer`.

- [ ] **Step 4: Write the module**

Create `apps/recipe-service/internal/recipe/normalize.go`:

```go
package recipe

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

//go:embed normalization.json
var normalizationJSON []byte

type unitDef struct {
	Dimension string  `json:"dimension"`
	ToBase    float64 `json:"toBase"`
	Display   bool    `json:"display"`
}

type itemDef struct {
	Display string `json:"display"`
	Aisle   string `json:"aisle"`
}

type normalizationData struct {
	Units      map[string]unitDef `json:"units"`
	Synonyms   map[string]string  `json:"synonyms"`
	Items      map[string]itemDef `json:"items"`
	AisleOrder []string           `json:"aisleOrder"`
}

// displayUnit is one rung of a dimension's friendly-display ladder.
type displayUnit struct {
	unit   string
	toBase float64
}

// Normalizer resolves ingredient synonyms, unit conversions, and aisles from the
// embedded normalization dataset. Built once via loadNormalizer; all methods are
// pure reads.
type Normalizer struct {
	data     normalizationData
	ladders  map[string][]displayUnit // dimension -> rungs, smallest toBase first
	aisleIdx map[string]int
}

func loadNormalizer(raw []byte) (*Normalizer, error) {
	var d normalizationData
	if err := json.Unmarshal(raw, &d); err != nil {
		return nil, fmt.Errorf("parse normalization.json: %w", err)
	}
	ladders := map[string][]displayUnit{}
	for name, u := range d.Units {
		if u.Display {
			ladders[u.Dimension] = append(ladders[u.Dimension], displayUnit{unit: name, toBase: u.ToBase})
		}
	}
	for dim := range ladders {
		l := ladders[dim]
		sort.Slice(l, func(i, j int) bool { return l[i].toBase < l[j].toBase })
		ladders[dim] = l
	}
	aisleIdx := map[string]int{}
	for i, a := range d.AisleOrder {
		aisleIdx[a] = i
	}
	return &Normalizer{data: d, ladders: ladders, aisleIdx: aisleIdx}, nil
}

var normalizer = mustLoadNormalizer()

func mustLoadNormalizer() *Normalizer {
	n, err := loadNormalizer(normalizationJSON)
	if err != nil {
		panic(fmt.Sprintf("load normalization.json: %v", err))
	}
	return n
}

// CanonicalItem resolves raw item text to a canonical key, a human display name,
// and a grocery aisle. Unknown items pass through: display keeps the first-seen
// original (trimmed) casing and the aisle is "other".
func (n *Normalizer) CanonicalItem(raw string) (canonical, display, aisle string) {
	norm := strings.ToLower(strings.TrimSpace(raw))
	if syn, ok := n.data.Synonyms[norm]; ok {
		norm = syn
	}
	if it, ok := n.data.Items[norm]; ok {
		return norm, it.Display, it.Aisle
	}
	return norm, strings.TrimSpace(raw), "other"
}

// Unit reports the dimension and base-unit factor for a convertible unit.
// ok is false for anything not in the dataset (non-convertible: "", clove, ...).
func (n *Normalizer) Unit(raw string) (dimension string, toBase float64, ok bool) {
	u, ok := n.data.Units[strings.ToLower(strings.TrimSpace(raw))]
	if !ok {
		return "", 0, false
	}
	return u.Dimension, u.ToBase, true
}

// aisleRank returns the shopping-flow index of an aisle; unknown aisles sort last.
func (n *Normalizer) aisleRank(aisle string) int {
	if i, ok := n.aisleIdx[aisle]; ok {
		return i
	}
	return len(n.data.AisleOrder)
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/recipe-service && go test ./internal/recipe/ -run 'CanonicalItem|Unit_Convertible|LoadNormalizer' -v`
Expected: PASS (all four).

- [ ] **Step 6: Commit**

```bash
git add apps/recipe-service/internal/recipe/normalization.json apps/recipe-service/internal/recipe/normalize.go apps/recipe-service/internal/recipe/normalize_test.go
git commit -m "feat(recipe-service): normalization dataset + item/unit lookup"
```

---

### Task 2: Friendly units + nice-fraction snapping

**Files:**
- Modify: `apps/recipe-service/internal/recipe/normalize.go`
- Test: `apps/recipe-service/internal/recipe/normalize_test.go`

**Interfaces:**
- Consumes: `*Normalizer.ladders` (Task 1).
- Produces: `func (n *Normalizer) Friendly(dimension string, baseQty float64) (qty float64, unit string)`; `func snapNice(v float64) float64`; `func niceValue(v float64) (float64, bool)`.

- [ ] **Step 1: Write the failing test**

Append to `apps/recipe-service/internal/recipe/normalize_test.go`:

```go
func TestSnapNice(t *testing.T) {
	cases := []struct {
		in, want float64
	}{
		{0.30000000000000004, 0.3}, // float noise, not a nice fraction -> 2dp
		{0.749, 0.75},              // within epsilon of 3/4
		{0.6667, 0.667},            // within epsilon of 2/3
		{2.0, 2.0},
		{2.51, 2.51}, // not nice -> 2dp
	}
	for _, c := range cases {
		if got := snapNice(c.in); got != c.want {
			t.Errorf("snapNice(%v) = %v, want %v", c.in, got, c.want)
		}
	}
}

func TestFriendly(t *testing.T) {
	cases := []struct {
		name    string
		dim     string
		baseQty float64
		wantQty float64
		wantU   string
	}{
		{"12 tbsp -> 3/4 cup", "volume", 12 * 14.7868, 0.75, "cup"},
		{"3 tsp -> 1 tbsp", "volume", 3 * 4.92892, 1, "tbsp"},
		{"2 tsp stays tsp", "volume", 2 * 4.92892, 2, "tsp"},
		{"4 tbsp -> 1/4 cup", "volume", 4 * 14.7868, 0.25, "cup"},
		{"750 g -> 3/4 kg", "mass", 750, 0.75, "kg"},
		{"200 g stays g", "mass", 200, 200, "g"},
	}
	for _, c := range cases {
		qty, unit := normalizer.Friendly(c.dim, c.baseQty)
		if qty != c.wantQty || unit != c.wantU {
			t.Errorf("%s: got (%v,%q), want (%v,%q)", c.name, qty, unit, c.wantQty, c.wantU)
		}
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/recipe-service && go test ./internal/recipe/ -run 'SnapNice|Friendly' -v`
Expected: FAIL — `undefined: snapNice` / `normalizer.Friendly`.

- [ ] **Step 3: Add the friendly-unit logic**

Append to `apps/recipe-service/internal/recipe/normalize.go` (add `"math"` to the import block):

```go
const (
	niceEpsilon   = 0.02
	bulkThreshold = 4.0
)

// niceFracs are the fractional parts we snap to (quarters, thirds, halves).
var niceFracs = []float64{0, 0.25, 1.0 / 3.0, 0.5, 2.0 / 3.0, 0.75, 1.0}

// niceValue snaps v to the nearest whole+nice-fraction within niceEpsilon.
// ok is false when v is not close to any nice value.
func niceValue(v float64) (float64, bool) {
	whole := math.Floor(v)
	frac := v - whole
	best, bestDist := 0.0, math.Inf(1)
	for _, f := range niceFracs {
		if d := math.Abs(frac - f); d < bestDist {
			bestDist, best = d, f
		}
	}
	if bestDist <= niceEpsilon {
		return math.Round((whole+best)*1000) / 1000, true
	}
	return 0, false
}

// snapNice returns v snapped to a nice value, or rounded to 2 decimals otherwise.
// This also erases float-sum noise like 0.1 + 0.2.
func snapNice(v float64) float64 {
	if s, ok := niceValue(v); ok {
		return s
	}
	return math.Round(v*100) / 100
}

// Friendly picks the largest display unit in which baseQty reads cleanly and
// returns the snapped quantity in that unit. It promotes to a larger unit when
// the amount is at least a whole there, or when the amount is bulky in the
// smaller unit (>= bulkThreshold) and lands on a nice fraction in the larger.
func (n *Normalizer) Friendly(dimension string, baseQty float64) (float64, string) {
	ladder := n.ladders[dimension]
	if len(ladder) == 0 {
		return snapNice(baseQty), dimension
	}
	idx := 0
	for idx < len(ladder)-1 {
		cur := ladder[idx]
		next := ladder[idx+1]
		q0 := baseQty / cur.toBase
		q1 := baseQty / next.toBase
		snapped1, ok1 := niceValue(q1)
		if q1 >= 1 || (ok1 && snapped1 >= 0.25 && snapped1 < 1 && q0 >= bulkThreshold) {
			idx++
			continue
		}
		break
	}
	chosen := ladder[idx]
	return snapNice(baseQty / chosen.toBase), chosen.unit
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/recipe-service && go test ./internal/recipe/ -run 'SnapNice|Friendly' -v`
Expected: PASS (both).

- [ ] **Step 5: Commit**

```bash
git add apps/recipe-service/internal/recipe/normalize.go apps/recipe-service/internal/recipe/normalize_test.go
git commit -m "feat(recipe-service): fraction-aware friendly unit selection"
```

---

### Task 3: Rewrite Aggregate to normalize, convert, and group by aisle

**Files:**
- Modify: `apps/recipe-service/internal/recipe/types.go`
- Modify: `apps/recipe-service/internal/recipe/aggregate.go`
- Modify: `apps/recipe-service/internal/recipe/aggregate_test.go`
- Modify: `apps/recipe-service/internal/recipe/handler_test.go:152`

**Interfaces:**
- Consumes: `normalizer.CanonicalItem`, `normalizer.Unit`, `normalizer.Friendly`, `normalizer.aisleRank`, `snapNice` (Tasks 1–2).
- Produces: `GroceryLine` with an added `Aisle string` field; `Aggregate([]Recipe) []GroceryLine` returning aisle-sorted lines.

- [ ] **Step 1: Add the `Aisle` field to the Go type**

In `apps/recipe-service/internal/recipe/types.go`, change the `GroceryLine` struct to:

```go
type GroceryLine struct {
	Item     string  `json:"item"`
	Unit     string  `json:"unit"`
	Quantity float64 `json:"quantity"`
	Aisle    string  `json:"aisle"`
}
```

- [ ] **Step 2: Update the existing tests to the new behavior**

Replace the bodies of `aggregate_test.go` tests as follows (the helper `r` stays). These assert canonicalized display names, the `aisle` field, and aisle-order sorting.

```go
func TestAggregate_CombinesSameItemAndUnit(t *testing.T) {
	got := Aggregate([]Recipe{
		r("a", Ingredient{Quantity: 2, Unit: "cloves", Item: "garlic"}),
		r("b", Ingredient{Quantity: 1, Unit: "cloves", Item: "garlic"}),
	})
	want := []GroceryLine{{Item: "Garlic", Unit: "cloves", Quantity: 3, Aisle: "produce"}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}

func TestAggregate_KeepsDifferentUnitsSeparate(t *testing.T) {
	got := Aggregate([]Recipe{
		r("a", Ingredient{Quantity: 2, Unit: "cloves", Item: "garlic"}),
		r("b", Ingredient{Quantity: 10, Unit: "grams", Item: "garlic"}),
	})
	want := []GroceryLine{
		{Item: "Garlic", Unit: "cloves", Quantity: 2, Aisle: "produce"},
		{Item: "Garlic", Unit: "grams", Quantity: 10, Aisle: "produce"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}

func TestAggregate_CombinesConvertibleUnits(t *testing.T) {
	// 4 tbsp + 0.5 cup butter = 12 tbsp -> 3/4 cup.
	got := Aggregate([]Recipe{
		r("a", Ingredient{Quantity: 4, Unit: "tbsp", Item: "butter"}),
		r("b", Ingredient{Quantity: 0.5, Unit: "cup", Item: "butter"}),
	})
	want := []GroceryLine{{Item: "Butter", Unit: "cup", Quantity: 0.75, Aisle: "dairy"}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}

func TestAggregate_MergesSynonyms(t *testing.T) {
	got := Aggregate([]Recipe{
		r("a", Ingredient{Quantity: 2, Unit: "cloves", Item: "garlic cloves"}),
		r("b", Ingredient{Quantity: 1, Unit: "cloves", Item: "fresh garlic"}),
	})
	want := []GroceryLine{{Item: "Garlic", Unit: "cloves", Quantity: 3, Aisle: "produce"}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}

func TestAggregate_MixedDimensionsForOneItemStaySeparate(t *testing.T) {
	// A count and a volume of the same canonical item can't merge.
	got := Aggregate([]Recipe{
		r("a", Ingredient{Quantity: 2, Unit: "clove", Item: "garlic"}),
		r("b", Ingredient{Quantity: 1, Unit: "tbsp", Item: "garlic"}),
	})
	want := []GroceryLine{
		{Item: "Garlic", Unit: "clove", Quantity: 2, Aisle: "produce"},
		{Item: "Garlic", Unit: "tbsp", Quantity: 1, Aisle: "produce"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}

func TestAggregate_SortsByAisleThenFirstSeen(t *testing.T) {
	// eggs (unknown -> other) seen first, milk (dairy) second; dairy sorts before other.
	got := Aggregate([]Recipe{
		r("a",
			Ingredient{Quantity: 1, Unit: "", Item: "eggs"},
			Ingredient{Quantity: 1, Unit: "cup", Item: "milk"},
		),
		r("b", Ingredient{Quantity: 2, Unit: "", Item: "eggs"}),
	})
	want := []GroceryLine{
		{Item: "Milk", Unit: "cup", Quantity: 1, Aisle: "dairy"},
		{Item: "eggs", Unit: "", Quantity: 3, Aisle: "other"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}

func TestAggregate_EmptyInputYieldsEmptySlice(t *testing.T) {
	got := Aggregate(nil)
	if got == nil {
		t.Fatal("got nil, want non-nil empty slice")
	}
	if len(got) != 0 {
		t.Fatalf("got %+v, want empty", got)
	}
}
```

(Delete the old `TestAggregate_MatchIsCaseAndSpaceInsensitive` and `TestAggregate_PreservesFirstSeenOrder` — they are superseded by the cases above.)

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd apps/recipe-service && go test ./internal/recipe/ -run TestAggregate -v`
Expected: FAIL — old `Aggregate` returns lowercased items, no `Aisle`, and insertion order.

- [ ] **Step 4: Rewrite `Aggregate`**

Replace the entire contents of `apps/recipe-service/internal/recipe/aggregate.go` with:

```go
package recipe

import (
	"sort"
	"strings"
)

// Aggregate combines ingredients across recipes into grocery lines. Items are
// canonicalized (synonyms -> canonical), compatible units are summed in a base
// unit and shown in a friendly unit, and each line is tagged with a grocery
// aisle. Lines are returned sorted by aisle order, then first-seen order.
// Non-convertible units (clove, "", ...) combine only on exact unit match.
func Aggregate(recipes []Recipe) []GroceryLine {
	type key struct{ item, bucket string }
	type acc struct {
		display string
		aisle   string
		unit    string  // non-convertible unit, or "" for convertible
		dim     string  // dimension for convertible, or "" otherwise
		base    float64 // convertible: sum in base units; else: raw sum
	}
	accs := map[key]*acc{}
	var order []key

	for _, rec := range recipes {
		for _, ing := range rec.Ingredients {
			canonical, display, aisle := normalizer.CanonicalItem(ing.Item)
			dim, toBase, convertible := normalizer.Unit(ing.Unit)

			var k key
			if convertible {
				k = key{canonical, "d:" + dim}
			} else {
				k = key{canonical, "u:" + strings.ToLower(strings.TrimSpace(ing.Unit))}
			}

			a := accs[k]
			if a == nil {
				a = &acc{display: display, aisle: aisle}
				if convertible {
					a.dim = dim
				} else {
					a.unit = strings.ToLower(strings.TrimSpace(ing.Unit))
				}
				accs[k] = a
				order = append(order, k)
			}
			if convertible {
				a.base += ing.Quantity * toBase
			} else {
				a.base += ing.Quantity
			}
		}
	}

	lines := make([]GroceryLine, 0, len(order))
	for _, k := range order {
		a := accs[k]
		var qty float64
		var unit string
		if a.dim != "" {
			qty, unit = normalizer.Friendly(a.dim, a.base)
		} else {
			qty, unit = snapNice(a.base), a.unit
		}
		lines = append(lines, GroceryLine{Item: a.display, Unit: unit, Quantity: qty, Aisle: a.aisle})
	}

	// Stable sort keeps first-seen order within an aisle.
	sort.SliceStable(lines, func(i, j int) bool {
		return normalizer.aisleRank(lines[i].Aisle) < normalizer.aisleRank(lines[j].Aisle)
	})
	return lines
}
```

- [ ] **Step 5: Fix the handler test expectation**

In `apps/recipe-service/internal/recipe/handler_test.go`, change the `want` line (around line 152) to:

```go
	want := []GroceryLine{{Item: "Garlic", Unit: "cloves", Quantity: 3, Aisle: "produce"}}
```

- [ ] **Step 6: Run the full package tests**

Run: `cd apps/recipe-service && go test ./...`
Expected: PASS (all packages).

- [ ] **Step 7: Commit**

```bash
git add apps/recipe-service/internal/recipe/types.go apps/recipe-service/internal/recipe/aggregate.go apps/recipe-service/internal/recipe/aggregate_test.go apps/recipe-service/internal/recipe/handler_test.go
git commit -m "feat(recipe-service): normalize, unit-convert, and aisle-group grocery lines"
```

---

### Task 4: Thread `aisle` through shared types and Convex

**Files:**
- Modify: `packages/types/src/index.ts:16-20`
- Modify: `packages/convex/convex/groceryList.ts`
- Modify: `packages/convex/convex/schema.ts:21-27`

**Interfaces:**
- Consumes: recipe-service now emits `aisle` on each grocery line (Task 3).
- Produces: `GroceryLine` TS type with `aisle: string`; `groceryList` Convex table + `groceryLineValidator` carrying `aisle`.

- [ ] **Step 1: Extend the shared type**

In `packages/types/src/index.ts`, change `GroceryLine` to:

```ts
export interface GroceryLine {
  item: string;
  unit: string;
  quantity: number;
  aisle: string;
}
```

- [ ] **Step 2: Extend the validator, insert, and schema**

In `packages/convex/convex/groceryList.ts`, update `groceryLineValidator` to include `aisle`:

```ts
export const groceryLineValidator = v.object({
  item: v.string(),
  unit: v.string(),
  quantity: v.number(),
  aisle: v.string(),
});
```

and in `replaceGroceryList`'s insert loop, add `aisle`:

```ts
    for (const line of lines) {
      await ctx.db.insert("groceryList", {
        userId: DEV_USER_ID,
        item: line.item,
        unit: line.unit,
        quantity: line.quantity,
        aisle: line.aisle,
        checked: false,
      });
    }
```

In `packages/convex/convex/schema.ts`, add `aisle` to the `groceryList` table:

```ts
  groceryList: defineTable({
    userId: v.string(),
    item: v.string(),
    unit: v.string(),
    quantity: v.number(),
    aisle: v.string(),
    checked: v.boolean(),
  }).index("by_user", ["userId"]),
```

- [ ] **Step 3: Typecheck the shared type and regenerate the Convex API**

Run: `pnpm --filter @pantry/types typecheck`
Expected: PASS (no errors).

Run: `pnpm --filter @pantry/convex codegen`
Expected: succeeds; `_groceryLineInSync` still compiles (validator and `@pantry/types` `GroceryLine` are back in sync) and the generated API now types `aisle` on grocery-list rows.

> If `codegen` needs a Convex login/network and can't run here, defer this check to Task 6's `pnpm --filter web typecheck`, which consumes the generated types.

- [ ] **Step 4: Commit**

```bash
git add packages/types/src/index.ts packages/convex/convex/groceryList.ts packages/convex/convex/schema.ts packages/convex/convex/_generated
git commit -m "feat(convex): carry aisle on grocery lines end to end"
```

---

### Task 5: Web `formatQuantity` fraction util

**Files:**
- Create: `apps/web/src/lib/formatQuantity.ts`
- Test: `apps/web/src/lib/formatQuantity.test.ts`

**Interfaces:**
- Produces: `export function formatQuantity(n: number): string`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/formatQuantity.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { formatQuantity } from "./formatQuantity";

describe("formatQuantity", () => {
  it("maps nice fractions to glyphs", () => {
    expect(formatQuantity(0.25)).toBe("¼");
    expect(formatQuantity(1 / 3)).toBe("⅓");
    expect(formatQuantity(0.5)).toBe("½");
    expect(formatQuantity(2 / 3)).toBe("⅔");
    expect(formatQuantity(0.75)).toBe("¾");
  });

  it("renders mixed numbers", () => {
    expect(formatQuantity(1.5)).toBe("1½");
    expect(formatQuantity(2.75)).toBe("2¾");
  });

  it("renders whole numbers plainly", () => {
    expect(formatQuantity(1)).toBe("1");
    expect(formatQuantity(12)).toBe("12");
  });

  it("falls back to a trimmed 2-decimal for non-nice values", () => {
    expect(formatQuantity(0.3)).toBe("0.3");
    expect(formatQuantity(2.51)).toBe("2.51");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test formatQuantity`
Expected: FAIL — cannot find module `./formatQuantity`.

- [ ] **Step 3: Write the util**

Create `apps/web/src/lib/formatQuantity.ts`:

```ts
// Renders a numeric quantity as a shopping-friendly string: nice fractions
// become glyphs (0.75 -> "¾", 1.5 -> "1½"), whole numbers stay plain, and
// anything else falls back to a trimmed 2-decimal number. Mirrors the
// nice-value set recipe-service uses to choose display units, so the unit and
// the glyph always agree.
const EPSILON = 0.02;
const FRACTIONS: Array<[value: number, glyph: string]> = [
  [0.25, "¼"],
  [1 / 3, "⅓"],
  [0.5, "½"],
  [2 / 3, "⅔"],
  [0.75, "¾"],
];

export function formatQuantity(n: number): string {
  const whole = Math.floor(n);
  const frac = n - whole;
  for (const [value, glyph] of FRACTIONS) {
    if (Math.abs(frac - value) <= EPSILON) {
      return whole === 0 ? glyph : `${whole}${glyph}`;
    }
  }
  if (Math.abs(frac) <= EPSILON) return String(whole);
  return String(Math.round(n * 100) / 100);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web test formatQuantity`
Expected: PASS (all four `describe` blocks).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/formatQuantity.ts apps/web/src/lib/formatQuantity.test.ts
git commit -m "feat(web): formatQuantity fraction-glyph helper"
```

---

### Task 6: Grouped, fraction-formatted grocery list

**Files:**
- Modify: `apps/web/src/components/GroceryList.tsx`
- Modify: `apps/web/src/components/GroceryList.test.tsx`

**Interfaces:**
- Consumes: `formatQuantity` (Task 5); grocery-list rows now carry `aisle` (Task 4); lines arrive pre-sorted by aisle (Task 3).

- [ ] **Step 1: Update the test fixtures and add grouping/glyph tests**

In `apps/web/src/components/GroceryList.test.tsx`, add `aisle` to the shared fixture and add two tests. Change `oneLine` to:

```ts
const oneLine = [
  { _id: "g1", userId: "dev-user", item: "egg", unit: "", quantity: 1, aisle: "other", checked: false, _creationTime: 0 },
];
```

and append inside the `describe("GroceryList", ...)` block:

```ts
  it("renders aisle section headers and groups lines under them", () => {
    state.lines = [
      { _id: "a", userId: "dev-user", item: "Milk", unit: "cup", quantity: 1, aisle: "dairy", checked: false, _creationTime: 0 },
      { _id: "b", userId: "dev-user", item: "Sriracha", unit: "tbsp", quantity: 2, aisle: "other", checked: false, _creationTime: 1 },
    ];
    render(<GroceryList />);
    expect(screen.getByText("Dairy")).toBeTruthy();
    expect(screen.getByText("Other")).toBeTruthy();
  });

  it("renders quantities as fraction glyphs", () => {
    state.lines = [
      { _id: "a", userId: "dev-user", item: "Butter", unit: "cup", quantity: 0.75, aisle: "dairy", checked: false, _creationTime: 0 },
    ];
    render(<GroceryList />);
    expect(screen.getByText(/¾ cup Butter/)).toBeTruthy();
  });
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `pnpm --filter web test GroceryList`
Expected: FAIL — no "Dairy"/"Other" headers; text is "0.75 cup Butter" not "¾ cup Butter".

- [ ] **Step 3: Rewrite the list body to group by aisle**

In `apps/web/src/components/GroceryList.tsx`, add the import and a title-case helper, and replace the `<ul>…</ul>` block (lines ~23–41) with grouped sections. Full updated file:

```tsx
import { useQuery, useMutation } from "convex/react";
import { api } from "@pantry/convex/api";
import { useAsyncAction } from "../lib/useAsyncAction";
import { toggleItemOptimistic, clearGroceryListOptimistic } from "../lib/optimistic";
import { formatQuantity } from "../lib/formatQuantity";
import { ErrorText } from "./ErrorText";
import { Card } from "./ui/Card";
import { Button } from "./ui/Button";

const titleCase = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export function GroceryList() {
  const lines = useQuery(api.groceryList.getGroceryList) ?? [];
  const toggle = useMutation(api.groceryList.toggleItem).withOptimisticUpdate(toggleItemOptimistic);
  const clearList = useMutation(api.groceryList.clearGroceryList).withOptimisticUpdate(clearGroceryListOptimistic);
  const { run, error } = useAsyncAction();

  function onClear() {
    if (!window.confirm("Clear the grocery list?")) return;
    run(() => clearList({}));
  }

  // Lines arrive pre-sorted by aisle from recipe-service; group consecutive runs.
  const groups: { aisle: string; lines: typeof lines }[] = [];
  for (const line of lines) {
    const last = groups[groups.length - 1];
    if (last && last.aisle === line.aisle) last.lines.push(line);
    else groups.push({ aisle: line.aisle, lines: [line] });
  }

  return (
    <Card title="Grocery list">
      {lines.length === 0 && <p className="text-sm text-muted">Nothing yet — generate from your basket.</p>}
      <div className="flex flex-col gap-3">
        {groups.map((group) => (
          <div key={group.aisle}>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{titleCase(group.aisle)}</h3>
            <ul className="flex flex-col gap-1">
              {group.lines.map((line) => (
                <li key={line._id}>
                  <label
                    className={`flex items-center gap-2 text-sm ${line.checked ? "text-muted line-through" : "text-text"}`}
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[var(--color-primary)]"
                      checked={line.checked}
                      onChange={(e) => run(() => toggle({ id: line._id, checked: e.target.checked }))}
                    />
                    <span>
                      {formatQuantity(line.quantity)} {line.unit} {line.item}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {lines.length > 0 && (
        <div className="mt-3 flex justify-end">
          <Button variant="ghost" size="sm" onClick={onClear}>
            Clear list
          </Button>
        </div>
      )}
      <ErrorText message={error} />
    </Card>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter web test GroceryList`
Expected: PASS — including the existing error/clear tests and the two new ones.

- [ ] **Step 5: Typecheck the web app**

Run: `pnpm --filter web typecheck`
Expected: PASS — confirms the generated Convex row type carries `aisle` (validates Task 4 end to end).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/GroceryList.tsx apps/web/src/components/GroceryList.test.tsx
git commit -m "feat(web): group grocery list by aisle with fraction quantities"
```

---

### Task 7: Full-stack verification + backlog close-out

**Files:**
- Modify: `docs/backlog/BL-0003-ingredient-normalization.md` (status → done)
- Modify: `docs/backlog/README.md` (index status → done)

- [ ] **Step 1: Run the whole test suite**

Run: `pnpm test` (root turbo pipeline) and `cd apps/recipe-service && go test ./...`
Expected: PASS across web, packages, and recipe-service.

- [ ] **Step 2: Manual smoke (optional but recommended)**

Use the `/run` skill or docker-compose to bring up recipe-service + Convex + web, add two recipes sharing an ingredient in different compatible units (e.g. `4 tbsp butter` and `0.5 cup butter`), generate the list, and confirm: a single `¾ cup Butter` line under a **Dairy** header, produce items under **Produce**, unknowns under **Other**.

- [ ] **Step 3: Mark BL-0003 done**

In `docs/backlog/BL-0003-ingredient-normalization.md` frontmatter, set `status: done`. In `docs/backlog/README.md`, change the BL-0003 row status to `done`.

- [ ] **Step 4: Commit**

```bash
git add docs/backlog/BL-0003-ingredient-normalization.md docs/backlog/README.md
git commit -m "docs(backlog): mark BL-0003 ingredient normalization done"
```
