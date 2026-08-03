# Recommendations Increment 1 — Preferences + Pantry Intent — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship "what can I make with what I have?" — a `POST /recommendations/pantry` endpoint backed by a pure scoring package, a real `preferences` schema with an allergen avoid-list, a "mark things to use up" pantry surface, and a results list that explains itself.

**Architecture:** A new **pure, dependency-free Go package** `internal/recommend` owns scoring: it receives a `UserContext` and pre-canonicalized `Candidate` recipes and returns ranked `Result`s. The HTTP handler lives in `internal/recipe` (which already owns auth, tracing, JSON helpers, and the recipe store) and adapts recipes into candidates. Convex owns all user state and POSTs it per request; the ranker stores nothing.

**Tech Stack:** Go 1.22+ (`net/http` ServeMux routing patterns), self-hosted Convex (`convex-test` + Vitest), React 19 + TanStack Router + Tailwind, Playwright.

## Global Constraints

- **The ranker is stateless.** `internal/recommend` must not import `internal/recipe`, must not touch a database, and must not read any user table. All user state arrives in the request body. Violating this collapses the architectural justification recorded in BL-0005's amendment.
- **Allergens are a hard filter, never a weight.** A candidate containing any `avoidItems` entry is removed from the pool before scoring. No score may surface it.
- **Hard filters fail closed.** If the avoid list cannot be applied, return zero results — never unfiltered ones.
- **Scoring is deterministic.** Sort by score descending, then `recipeId` ascending. Identical input always yields identical order.
- **Unavailable features are excluded from numerator *and* denominator.** `score = Σ(wᵢ·fᵢ) / Σ(wᵢ)` over available features only.
- **Recommendations are additive.** A failure in this feature must never break `/pantry` or `/recipes`.
- **Convex verification needs the running self-hosted backend.** `convex codegen`, typecheck, and deploy all require it. `.env.local` must use `CONVEX_SELF_HOSTED_URL` on port **3210** — port 3212 is a phantom anonymous deployment the web app never uses.
- **Biome no-ops from a worktree root.** `pnpm biome check` checks 0 files here and passes vacuously. Lint changed files **by explicit path**.
- **Commit style:** conventional commits. Do not open PRs as drafts.

---

## Deviation from the spec's file layout (read before Task 1)

The design doc places `candidates.go` and the HTTP endpoints inside `internal/recommend`. **That is not buildable as written**: candidate assembly needs `recipe.Store` and the unexported `normalizer`, so `recommend` would import `recipe`; the HTTP handler registers on `recipe`'s mux, so `recipe` would import `recommend`. That is an import cycle.

This plan resolves it by moving the boundary one notch:

| Concern | Package | Why |
| --- | --- | --- |
| Scoring, features, weights, reasons, types | `internal/recommend` | pure, no imports, trivially testable |
| Candidate assembly + canonicalization | `internal/recipe` | already owns `Store` and `normalizer` |
| HTTP handler, auth, tracing, JSON | `internal/recipe` | already owns all of it |

`recommend` receives `Candidate` values whose ingredients are **already canonicalized** by the caller. This is a *stronger* boundary than the spec described — `recommend` has zero dependencies — and extraction to a separate service remains a refactor.

**Increment 1 has exactly two live features:** `useItUpHits` and `coverage`. `affinity` needs the event log (increment 2), `missingNonStaple` needs a `staple` flag (BL-0031), and `recentlyPlanned` needs plan *history* (the basket is current-week only). All three are wired and report unavailable — that is the degradation mechanism doing its job, not an omission.

---

### Task 1: `recommend` package — types, weights, and the scoring core

**Files:**
- Create: `apps/recipe-service/internal/recommend/types.go`
- Create: `apps/recipe-service/internal/recommend/weights.go`
- Create: `apps/recipe-service/internal/recommend/score.go`
- Test: `apps/recipe-service/internal/recommend/score_test.go`

**Interfaces:**
- Consumes: nothing (this is the root of the dependency graph).
- Produces: `recommend.UserContext`, `recommend.PantryItem`, `recommend.Preferences`, `recommend.Candidate`, `recommend.CandidateIngredient`, `recommend.Result`, `recommend.MissingItem`, `recommend.Weights`, `recommend.DefaultPantryWeights`, and the unexported `feature` struct + `combine([]feature) float64`.

- [ ] **Step 1: Write the failing test**

Create `apps/recipe-service/internal/recommend/score_test.go`:

```go
package recommend

import (
	"math"
	"testing"
)

func closeTo(t *testing.T, got, want float64) {
	t.Helper()
	if math.Abs(got-want) > 1e-9 {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestCombineAveragesByWeight(t *testing.T) {
	// 3*1.0 + 1*0.0 = 3, over weight 4 => 0.75
	got := combine([]feature{
		{name: "a", value: 1.0, weight: 3, available: true},
		{name: "b", value: 0.0, weight: 1, available: true},
	})
	closeTo(t, got, 0.75)
}

// The core degradation guarantee: an unavailable feature leaves the score of
// the remaining features untouched. It must not count as a zero.
func TestCombineIgnoresUnavailableFeatures(t *testing.T) {
	withAll := combine([]feature{
		{name: "a", value: 1.0, weight: 3, available: true},
		{name: "b", value: 0.5, weight: 1, available: false},
	})
	onlyAvailable := combine([]feature{
		{name: "a", value: 1.0, weight: 3, available: true},
	})
	closeTo(t, withAll, onlyAvailable)
	closeTo(t, withAll, 1.0)
}

func TestCombineReturnsZeroWhenNothingAvailable(t *testing.T) {
	closeTo(t, combine([]feature{{name: "a", value: 1, weight: 1, available: false}}), 0)
	closeTo(t, combine(nil), 0)
}

// Penalties are negative values, so the raw sum can leave [0,1]. Clamp.
func TestCombineClampsToUnitInterval(t *testing.T) {
	closeTo(t, combine([]feature{{name: "p", value: -1, weight: 1, available: true}}), 0)
	closeTo(t, combine([]feature{{name: "p", value: 2, weight: 1, available: true}}), 1)
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/recipe-service && go test ./internal/recommend/ -run TestCombine -v`
Expected: FAIL — the package does not exist yet (`no Go files in .../internal/recommend`).

- [ ] **Step 3: Write the types**

Create `apps/recipe-service/internal/recommend/types.go`:

```go
// Package recommend scores recipes against a user's pantry and preferences.
//
// It is deliberately DEPENDENCY-FREE: it imports nothing from the rest of the
// service, holds no state, and touches no database. Everything it knows about
// the caller arrives in a UserContext, and candidate recipes arrive with their
// ingredients ALREADY canonicalized. That is what keeps the ranker stateless
// (see BL-0005) and what makes every function here a pure, table-testable unit.
package recommend

// PantryItem is one thing the user has, keyed on the normalized ingredient id.
type PantryItem struct {
	CanonicalItem string `json:"canonicalItem"`
	State         string `json:"state"` // "have" | "low" | "out"
	UseItUp       bool   `json:"useItUp"`
}

// Preferences is the ingredient-grounded preference signal. AvoidItems is a
// HARD FILTER, never a weight — see RankPantry.
type Preferences struct {
	AvoidItems    []string `json:"avoidItems"`
	LikedItems    []string `json:"likedItems"`
	DislikedItems []string `json:"dislikedItems"`
}

// UserContext is everything the ranker knows about the caller for one request.
type UserContext struct {
	Pantry           []PantryItem       `json:"pantry"`
	Preferences      Preferences        `json:"preferences"`
	Affinities       map[string]float64 `json:"affinities"`
	SavedRecipeIDs   []string           `json:"savedRecipeIds"`
	ExcludeRecipeIDs []string           `json:"excludeRecipeIds"`
	Limit            int                `json:"limit"`
}

// CandidateIngredient is one ingredient reduced to what scoring needs.
type CandidateIngredient struct {
	CanonicalItem string
	Display       string
}

// Candidate is a recipe reduced to identity plus canonicalized ingredients.
// The CALLER canonicalizes; recommend never sees raw ingredient text.
type Candidate struct {
	RecipeID    string
	Title       string
	Source      string // "catalog" | "user"
	Ingredients []CandidateIngredient
}

// MissingItem is an ingredient the recipe needs that the user does not have.
type MissingItem struct {
	CanonicalItem string `json:"canonicalItem"`
	Display       string `json:"display"`
}

// Result is one ranked recommendation, carrying the reasons that produced it so
// the UI can explain itself without knowing anything about scoring.
type Result struct {
	RecipeID string        `json:"recipeId"`
	Title    string        `json:"title"`
	Source   string        `json:"source"`
	Score    float64       `json:"score"`
	Reasons  []string      `json:"reasons"`
	Have     []string      `json:"have"`
	Missing  []MissingItem `json:"missing"`
}
```

- [ ] **Step 4: Write the weights**

Create `apps/recipe-service/internal/recommend/weights.go`:

```go
package recommend

// Weights are hand-tuned constants, not learned. They live in one struct so a
// tuning change is a single visible diff, and they are pinned by
// TestDefaultPantryWeightsArePinned so the change has to be deliberate.
type Weights struct {
	UseItUpHits      float64
	Coverage         float64
	MissingNonStaple float64
	Affinity         float64
	RecentlyPlanned  float64
}

// DefaultPantryWeights favours clearing flagged use-it-up items over raw
// coverage: coverage alone would just rank whichever recipe has the fewest
// ingredients, and clearing what the user explicitly flagged is the point of
// the pantry intent.
//
// MissingNonStaple, Affinity and RecentlyPlanned have weights here but their
// features report UNAVAILABLE in increment 1 (no staple flag, no event log, no
// plan history), so they contribute to neither the numerator nor the
// denominator. See combine().
var DefaultPantryWeights = Weights{
	UseItUpHits:      3.0,
	Coverage:         2.0,
	MissingNonStaple: 1.0,
	Affinity:         1.0,
	RecentlyPlanned:  1.0,
}
```

- [ ] **Step 5: Write the scoring core**

Create `apps/recipe-service/internal/recommend/score.go`:

```go
package recommend

// feature is one scored dimension.
//
// `available` reports whether the DATA BACKING this feature exists yet. An
// unavailable feature is excluded from both the numerator and the denominator,
// so a feature whose backing backlog item has not shipped cannot drag a score
// toward zero — it simply is not part of the average. This is what lets
// BL-0029 expiry and BL-0023 cost join later as pure additions.
//
// value is expected in [-1, 1]; penalties are expressed as negative values.
type feature struct {
	name      string
	value     float64
	weight    float64
	available bool
}

// combine folds features into a single score in [0, 1], normalizing by the
// weight of the features that actually had data. Returns 0 when none did.
func combine(fs []feature) float64 {
	var num, den float64
	for _, f := range fs {
		if !f.available {
			continue
		}
		num += f.weight * f.value
		den += f.weight
	}
	if den == 0 {
		return 0
	}
	score := num / den
	if score < 0 {
		return 0
	}
	if score > 1 {
		return 1
	}
	return score
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd apps/recipe-service && go test ./internal/recommend/ -v`
Expected: PASS — 4 tests (`TestCombineAveragesByWeight`, `TestCombineIgnoresUnavailableFeatures`, `TestCombineReturnsZeroWhenNothingAvailable`, `TestCombineClampsToUnitInterval`).

- [ ] **Step 7: Add the weight-pinning test**

Append to `apps/recipe-service/internal/recommend/score_test.go`:

```go
// Weights are a product decision, not an implementation detail. Pinning them
// means a tuning change shows up as an intentional diff in review.
func TestDefaultPantryWeightsArePinned(t *testing.T) {
	want := Weights{
		UseItUpHits:      3.0,
		Coverage:         2.0,
		MissingNonStaple: 1.0,
		Affinity:         1.0,
		RecentlyPlanned:  1.0,
	}
	if DefaultPantryWeights != want {
		t.Fatalf("pantry weights changed: got %+v, want %+v\n"+
			"If this change is intentional, update the expectation in this test.", DefaultPantryWeights, want)
	}
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd apps/recipe-service && go test ./internal/recommend/ -v`
Expected: PASS — 5 tests.

- [ ] **Step 9: Commit**

```bash
git add apps/recipe-service/internal/recommend/
git commit -m "feat(recommend): scoring core with availability-normalized features"
```

---

### Task 2: `recommend` package — pantry ranker, hard filter, and reasons

**Files:**
- Create: `apps/recipe-service/internal/recommend/features.go`
- Create: `apps/recipe-service/internal/recommend/reasons.go`
- Create: `apps/recipe-service/internal/recommend/pantry.go`
- Test: `apps/recipe-service/internal/recommend/pantry_test.go`

**Interfaces:**
- Consumes: everything from Task 1 — `UserContext`, `Candidate`, `Result`, `Weights`, `DefaultPantryWeights`, `feature`, `combine`.
- Produces: `func RankPantry(uc UserContext, candidates []Candidate) []Result`.

- [ ] **Step 1: Write the failing tests**

Create `apps/recipe-service/internal/recommend/pantry_test.go`:

```go
package recommend

import "testing"

func cand(id, title string, items ...string) Candidate {
	ings := make([]CandidateIngredient, 0, len(items))
	for _, it := range items {
		ings = append(ings, CandidateIngredient{CanonicalItem: it, Display: it})
	}
	return Candidate{RecipeID: id, Title: title, Source: "catalog", Ingredients: ings}
}

func have(items ...string) []PantryItem {
	out := make([]PantryItem, 0, len(items))
	for _, it := range items {
		out = append(out, PantryItem{CanonicalItem: it, State: "have"})
	}
	return out
}

func ids(rs []Result) []string {
	out := make([]string, 0, len(rs))
	for _, r := range rs {
		out = append(out, r.RecipeID)
	}
	return out
}

func eq(t *testing.T, got, want []string) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for i := range got {
		if got[i] != want[i] {
			t.Fatalf("got %v, want %v", got, want)
		}
	}
}

func TestRankPantryPrefersHigherCoverage(t *testing.T) {
	uc := UserContext{Pantry: have("tomato", "onion", "garlic")}
	got := RankPantry(uc, []Candidate{
		cand("low", "Low", "tomato", "beef", "wine", "cream"),
		cand("high", "High", "tomato", "onion", "garlic"),
	})
	eq(t, ids(got), []string{"high", "low"})
}

// The whole point of the pantry intent: a flagged use-it-up item outranks raw
// coverage, because the user explicitly asked to clear it.
func TestRankPantryPrefersUseItUpOverCoverage(t *testing.T) {
	uc := UserContext{Pantry: []PantryItem{
		{CanonicalItem: "tomato", State: "have"},
		{CanonicalItem: "onion", State: "have"},
		{CanonicalItem: "basil", State: "have", UseItUp: true},
	}}
	got := RankPantry(uc, []Candidate{
		cand("full", "Full", "tomato", "onion"),
		cand("uses-basil", "Uses basil", "basil", "tomato", "onion"),
	})
	eq(t, ids(got), []string{"uses-basil", "full"})
}

// HARD FILTER. Not a weight — no score may surface an avoided ingredient.
func TestRankPantryRemovesAvoidedIngredients(t *testing.T) {
	uc := UserContext{
		Pantry:      have("peanut", "rice"),
		Preferences: Preferences{AvoidItems: []string{"peanut"}},
	}
	got := RankPantry(uc, []Candidate{
		cand("satay", "Satay", "peanut", "rice"),
		cand("plain", "Plain rice", "rice"),
	})
	eq(t, ids(got), []string{"plain"})
}

func TestRankPantryExcludesAlreadyPlannedRecipes(t *testing.T) {
	uc := UserContext{Pantry: have("rice"), ExcludeRecipeIDs: []string{"planned"}}
	got := RankPantry(uc, []Candidate{
		cand("planned", "Planned", "rice"),
		cand("open", "Open", "rice"),
	})
	eq(t, ids(got), []string{"open"})
}

// A recipe with nothing in common with the pantry has nothing to say; dropping
// it is what makes the "Nothing close yet" empty state meaningful.
func TestRankPantryDropsCandidatesWithNoOverlap(t *testing.T) {
	uc := UserContext{Pantry: have("rice")}
	got := RankPantry(uc, []Candidate{cand("nope", "Nope", "beef", "wine")})
	eq(t, ids(got), []string{})
}

func TestRankPantryReportsHaveAndMissing(t *testing.T) {
	uc := UserContext{Pantry: have("tomato")}
	got := RankPantry(uc, []Candidate{cand("soup", "Soup", "tomato", "onion")})
	if len(got) != 1 {
		t.Fatalf("got %d results, want 1", len(got))
	}
	eq(t, got[0].Have, []string{"tomato"})
	if len(got[0].Missing) != 1 || got[0].Missing[0].CanonicalItem != "onion" {
		t.Fatalf("missing = %+v, want [onion]", got[0].Missing)
	}
}

func TestRankPantryExplainsItself(t *testing.T) {
	uc := UserContext{Pantry: []PantryItem{
		{CanonicalItem: "basil", State: "have", UseItUp: true},
		{CanonicalItem: "tomato", State: "have"},
	}}
	got := RankPantry(uc, []Candidate{cand("soup", "Soup", "basil", "tomato")})
	if len(got) != 1 {
		t.Fatalf("got %d results, want 1", len(got))
	}
	if len(got[0].Reasons) == 0 {
		t.Fatal("expected at least one reason")
	}
	if got[0].Reasons[0] != "Uses up: basil" {
		t.Fatalf("first reason = %q, want %q", got[0].Reasons[0], "Uses up: basil")
	}
}

// "low" still counts as owned; "out" does not.
func TestRankPantryTreatsLowAsOwnedAndOutAsNot(t *testing.T) {
	uc := UserContext{Pantry: []PantryItem{
		{CanonicalItem: "rice", State: "low"},
		{CanonicalItem: "beef", State: "out"},
	}}
	got := RankPantry(uc, []Candidate{cand("bowl", "Bowl", "rice", "beef")})
	if len(got) != 1 {
		t.Fatalf("got %d results, want 1", len(got))
	}
	eq(t, got[0].Have, []string{"rice"})
	if len(got[0].Missing) != 1 || got[0].Missing[0].CanonicalItem != "beef" {
		t.Fatalf("missing = %+v, want [beef]", got[0].Missing)
	}
}

// Determinism: equal scores break the tie on recipeId, always the same way.
func TestRankPantryIsDeterministicOnTies(t *testing.T) {
	uc := UserContext{Pantry: have("rice")}
	candidates := []Candidate{cand("zebra", "Zebra", "rice"), cand("apple", "Apple", "rice")}
	first := ids(RankPantry(uc, candidates))
	for i := 0; i < 5; i++ {
		eq(t, ids(RankPantry(uc, candidates)), first)
	}
	eq(t, first, []string{"apple", "zebra"})
}

func TestRankPantryHonoursLimit(t *testing.T) {
	uc := UserContext{Pantry: have("rice"), Limit: 1}
	got := RankPantry(uc, []Candidate{cand("a", "A", "rice"), cand("b", "B", "rice")})
	if len(got) != 1 {
		t.Fatalf("got %d results, want 1", len(got))
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/recipe-service && go test ./internal/recommend/ -run TestRankPantry -v`
Expected: FAIL — `undefined: RankPantry`.

- [ ] **Step 3: Write the feature extraction**

Create `apps/recipe-service/internal/recommend/features.go`:

```go
package recommend

// pantryView is the user's pantry indexed for lookup, computed once per request
// rather than per candidate.
type pantryView struct {
	owned   map[string]bool // state "have" or "low"
	useItUp map[string]bool // owned AND flagged to use up
	flagged int             // how many items are flagged overall
}

func newPantryView(items []PantryItem) pantryView {
	v := pantryView{owned: map[string]bool{}, useItUp: map[string]bool{}}
	for _, it := range items {
		// "out" means the user told us it is gone. Only "have"/"low" count.
		if it.State != "have" && it.State != "low" {
			continue
		}
		v.owned[it.CanonicalItem] = true
		if it.UseItUp {
			v.useItUp[it.CanonicalItem] = true
			v.flagged++
		}
	}
	return v
}

// match is what one candidate looks like against one pantry.
type match struct {
	have       []string
	missing    []MissingItem
	useItUpHit []string
	total      int
}

// matchCandidate walks a candidate's ingredients once, de-duplicating by
// canonical item (a recipe can list "garlic" twice in different units).
func matchCandidate(c Candidate, v pantryView) match {
	var m match
	seen := map[string]bool{}
	for _, ing := range c.Ingredients {
		if seen[ing.CanonicalItem] {
			continue
		}
		seen[ing.CanonicalItem] = true
		m.total++
		switch {
		case v.useItUp[ing.CanonicalItem]:
			m.useItUpHit = append(m.useItUpHit, ing.CanonicalItem)
			m.have = append(m.have, ing.CanonicalItem)
		case v.owned[ing.CanonicalItem]:
			m.have = append(m.have, ing.CanonicalItem)
		default:
			m.missing = append(m.missing, MissingItem{CanonicalItem: ing.CanonicalItem, Display: ing.Display})
		}
	}
	return m
}

// useItUpSaturation is how many flagged items a single recipe has to clear to
// earn a perfect use-it-up score. Without a cap, flagging 20 items would make
// every recipe score near zero on the feature that matters most.
const useItUpSaturation = 3

func pantryFeatures(m match, v pantryView, w Weights) []feature {
	var useItUpValue float64
	if v.flagged > 0 {
		denom := min(v.flagged, useItUpSaturation)
		useItUpValue = float64(len(m.useItUpHit)) / float64(denom)
		if useItUpValue > 1 {
			useItUpValue = 1
		}
	}

	var coverage float64
	if m.total > 0 {
		coverage = float64(len(m.have)) / float64(m.total)
	}

	return []feature{
		{
			name:  "useItUpHits",
			value: useItUpValue,
			weight: w.UseItUpHits,
			// Unavailable when the user has flagged nothing — there is no signal
			// to read, so it must not count as a zero against every candidate.
			available: v.flagged > 0,
		},
		{name: "coverage", value: coverage, weight: w.Coverage, available: m.total > 0},

		// --- wired, inert in increment 1 ---
		// Needs a `staple` flag on canonical items (BL-0031).
		{name: "missingNonStaple", value: 0, weight: w.MissingNonStaple, available: false},
		// Needs the interaction event log (increment 2).
		{name: "affinity", value: 0, weight: w.Affinity, available: false},
		// Needs plan HISTORY; the basket is current-week only, and current-week
		// recipes are hard-excluded via ExcludeRecipeIDs instead.
		{name: "recentlyPlanned", value: 0, weight: w.RecentlyPlanned, available: false},
	}
}
```

- [ ] **Step 4: Write the reasons**

Create `apps/recipe-service/internal/recommend/reasons.go`:

```go
package recommend

import (
	"fmt"
	"strings"
)

// maxNamedItems caps how many ingredients a reason names before it summarizes.
const maxNamedItems = 3

// pantryReasons renders the winning features as human strings, most important
// first. The UI shows the top two or three, so ordering here is the ranking of
// what matters: what you asked to use up, then how much you already have.
func pantryReasons(m match) []string {
	var out []string

	if len(m.useItUpHit) > 0 {
		named := m.useItUpHit
		if len(named) > maxNamedItems {
			named = named[:maxNamedItems]
		}
		out = append(out, "Uses up: "+strings.Join(named, ", "))
	}

	switch {
	case len(m.missing) == 0 && len(m.have) > 0:
		out = append(out, "You have everything")
	case len(m.have) == 1:
		out = append(out, "Uses 1 thing you have")
	case len(m.have) > 1:
		out = append(out, fmt.Sprintf("Uses %d things you have", len(m.have)))
	}

	if n := len(m.missing); n > 0 && n <= 2 {
		out = append(out, fmt.Sprintf("You need %d more", n))
	}

	return out
}
```

- [ ] **Step 5: Write the ranker**

Create `apps/recipe-service/internal/recommend/pantry.go`:

```go
package recommend

import "sort"

const (
	defaultLimit = 20
	maxLimit     = 50
)

// RankPantry scores candidates for the "cook what I have" intent.
//
// Order of operations matters: hard filters run BEFORE scoring, so no score can
// surface an avoided ingredient.
func RankPantry(uc UserContext, candidates []Candidate) []Result {
	return rankPantryWith(uc, candidates, DefaultPantryWeights)
}

func rankPantryWith(uc UserContext, candidates []Candidate, w Weights) []Result {
	avoid := toSet(uc.Preferences.AvoidItems)
	exclude := toSet(uc.ExcludeRecipeIDs)
	view := newPantryView(uc.Pantry)

	results := make([]Result, 0, len(candidates))
	for _, c := range candidates {
		if exclude[c.RecipeID] || containsAvoided(c, avoid) {
			continue
		}
		m := matchCandidate(c, view)
		// Nothing in common with the pantry means nothing to say about it.
		if len(m.have) == 0 {
			continue
		}
		results = append(results, Result{
			RecipeID: c.RecipeID,
			Title:    c.Title,
			Source:   c.Source,
			Score:    combine(pantryFeatures(m, view, w)),
			Reasons:  pantryReasons(m),
			Have:     m.have,
			Missing:  m.missing,
		})
	}

	// Deterministic: score descending, then recipeId ascending. Without the
	// tiebreak, equal scores would surface in map/slice order and reshuffle.
	sort.SliceStable(results, func(i, j int) bool {
		if results[i].Score != results[j].Score {
			return results[i].Score > results[j].Score
		}
		return results[i].RecipeID < results[j].RecipeID
	})

	limit := uc.Limit
	if limit <= 0 {
		limit = defaultLimit
	}
	if limit > maxLimit {
		limit = maxLimit
	}
	if len(results) > limit {
		results = results[:limit]
	}
	return results
}

func containsAvoided(c Candidate, avoid map[string]bool) bool {
	if len(avoid) == 0 {
		return false
	}
	for _, ing := range c.Ingredients {
		if avoid[ing.CanonicalItem] {
			return true
		}
	}
	return false
}

func toSet(xs []string) map[string]bool {
	if len(xs) == 0 {
		return nil
	}
	s := make(map[string]bool, len(xs))
	for _, x := range xs {
		s[x] = true
	}
	return s
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd apps/recipe-service && go test ./internal/recommend/ -v`
Expected: PASS — all tests from Tasks 1 and 2 (15 total).

- [ ] **Step 7: Vet and lint**

Run: `cd apps/recipe-service && go vet ./internal/recommend/ && golangci-lint run ./internal/recommend/`
Expected: no output (clean).

- [ ] **Step 8: Commit**

```bash
git add apps/recipe-service/internal/recommend/
git commit -m "feat(recommend): pantry ranker with avoid-list hard filter and reasons"
```

---

### Task 3: recipe-service HTTP endpoint + candidate assembly

**Files:**
- Create: `apps/recipe-service/internal/recipe/recommend.go`
- Modify: `apps/recipe-service/internal/recipe/handler.go` (register one route in `NewRouterWithImporter`)
- Test: `apps/recipe-service/internal/recipe/recommend_test.go`

**Interfaces:**
- Consumes: `recommend.UserContext`, `recommend.Candidate`, `recommend.CandidateIngredient`, `recommend.Result`, `recommend.RankPantry` (Task 2); existing `Store`, `CatalogUserID`, `normalizer`, `decodeJSON`, `writeJSON`, `writeErr`, `userIDFrom`, `traced`.
- Produces: route `POST /recommendations/pantry` returning `{"results": [...]}`.

- [ ] **Step 1: Write the failing tests**

Create `apps/recipe-service/internal/recipe/recommend_test.go`:

```go
package recipe

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"testing"
)

type recResponse struct {
	Results []struct {
		RecipeID string   `json:"recipeId"`
		Title    string   `json:"title"`
		Source   string   `json:"source"`
		Score    float64  `json:"score"`
		Reasons  []string `json:"reasons"`
		Have     []string `json:"have"`
		Missing  []struct {
			CanonicalItem string `json:"canonicalItem"`
			Display       string `json:"display"`
		} `json:"missing"`
	} `json:"results"`
}

func postRecommendations(t *testing.T, srv string, body any) recResponse {
	t.Helper()
	buf, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	resp := doAuth(t, http.MethodPost, srv+"/recommendations/pantry", bytes.NewReader(buf))
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	var out recResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	return out
}

func TestRecommendPantryRanksOwnAndCatalogRecipes(t *testing.T) {
	srv, store := newTestServer(t)

	if _, err := store.CreateRecipe(context.Background(), "user-a", "Garlic Rice", []Ingredient{
		{Quantity: 1, Unit: "cup", Item: "rice"},
		{Quantity: 2, Unit: "cloves", Item: "garlic"},
	}); err != nil {
		t.Fatalf("create: %v", err)
	}
	if err := store.UpsertRecipe(context.Background(), Recipe{
		ID: "cat-x", UserID: CatalogUserID, Title: "Catalog Rice",
		Ingredients: []Ingredient{{Quantity: 1, Unit: "cup", Item: "rice"}},
	}); err != nil {
		t.Fatalf("upsert: %v", err)
	}

	out := postRecommendations(t, srv.URL, map[string]any{
		"pantry": []map[string]any{
			{"canonicalItem": "rice", "state": "have"},
			{"canonicalItem": "garlic", "state": "have"},
		},
	})

	if len(out.Results) != 2 {
		t.Fatalf("got %d results, want 2: %+v", len(out.Results), out.Results)
	}
	sources := map[string]string{}
	for _, r := range out.Results {
		sources[r.Title] = r.Source
	}
	if sources["Garlic Rice"] != "user" {
		t.Fatalf("Garlic Rice source = %q, want user", sources["Garlic Rice"])
	}
	if sources["Catalog Rice"] != "catalog" {
		t.Fatalf("Catalog Rice source = %q, want catalog", sources["Catalog Rice"])
	}
}

// Ingredient text must be canonicalized before scoring — "scallions" and
// "green onion" are the same pantry row.
func TestRecommendPantryCanonicalizesIngredients(t *testing.T) {
	srv, store := newTestServer(t)
	if _, err := store.CreateRecipe(context.Background(), "user-a", "Scallion Bowl", []Ingredient{
		{Quantity: 2, Unit: "whole", Item: "scallions"},
	}); err != nil {
		t.Fatalf("create: %v", err)
	}

	out := postRecommendations(t, srv.URL, map[string]any{
		"pantry": []map[string]any{{"canonicalItem": "green onion", "state": "have"}},
	})

	if len(out.Results) != 1 {
		t.Fatalf("got %d results, want 1", len(out.Results))
	}
	if len(out.Results[0].Have) != 1 || out.Results[0].Have[0] != "green onion" {
		t.Fatalf("have = %v, want [green onion]", out.Results[0].Have)
	}
}

// Cross-user isolation: another user's private recipe must never be a candidate.
func TestRecommendPantryNeverLeaksAnotherUsersRecipes(t *testing.T) {
	srv, store := newTestServer(t)
	if _, err := store.CreateRecipe(context.Background(), "user-b", "Secret Rice", []Ingredient{
		{Quantity: 1, Unit: "cup", Item: "rice"},
	}); err != nil {
		t.Fatalf("create: %v", err)
	}

	out := postRecommendations(t, srv.URL, map[string]any{
		"pantry": []map[string]any{{"canonicalItem": "rice", "state": "have"}},
	})

	for _, r := range out.Results {
		if r.Title == "Secret Rice" {
			t.Fatal("leaked another user's recipe into recommendations")
		}
	}
}

func TestRecommendPantryAppliesAvoidList(t *testing.T) {
	srv, store := newTestServer(t)
	if _, err := store.CreateRecipe(context.Background(), "user-a", "Peanut Rice", []Ingredient{
		{Quantity: 1, Unit: "cup", Item: "rice"},
		{Quantity: 2, Unit: "tbsp", Item: "peanut"},
	}); err != nil {
		t.Fatalf("create: %v", err)
	}

	out := postRecommendations(t, srv.URL, map[string]any{
		"pantry":      []map[string]any{{"canonicalItem": "rice", "state": "have"}},
		"preferences": map[string]any{"avoidItems": []string{"peanut"}},
	})

	if len(out.Results) != 0 {
		t.Fatalf("avoided recipe surfaced: %+v", out.Results)
	}
}

func TestRecommendPantryReturnsEmptyListNotNull(t *testing.T) {
	srv, _ := newTestServer(t)
	out := postRecommendations(t, srv.URL, map[string]any{"pantry": []map[string]any{}})
	if out.Results == nil {
		t.Fatal("results was null; must serialize as []")
	}
}

func TestRecommendPantryRejectsMalformedBody(t *testing.T) {
	srv, _ := newTestServer(t)
	resp := doAuth(t, http.MethodPost, srv.URL+"/recommendations/pantry", bytes.NewReader([]byte("{")))
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", resp.StatusCode)
	}
}

func TestRecommendPantryRequiresAuth(t *testing.T) {
	srv, _ := newTestServer(t)
	req, err := http.NewRequest(http.MethodPost, srv.URL+"/recommendations/pantry", bytes.NewReader([]byte("{}")))
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("do: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", resp.StatusCode)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/recipe-service && go test ./internal/recipe/ -run TestRecommend -v`
Expected: FAIL — the route is unregistered, so `ServeMux` returns 404 and `postRecommendations` fails on `status = 404, want 200`.

- [ ] **Step 3: Write the handler and candidate assembly**

Create `apps/recipe-service/internal/recipe/recommend.go`:

```go
package recipe

import (
	"context"
	"net/http"

	"pantry/apps/recipe-service/internal/recommend"
)

// recommendPantry ranks the caller's recipes plus the shared catalog against
// the pantry and preferences carried in the request body.
//
// The ranker is stateless by construction: everything about the user arrives
// here in the payload, and this handler only adds the recipe corpus.
func (h *handlers) recommendPantry(w http.ResponseWriter, r *http.Request) {
	var uc recommend.UserContext
	if !decodeJSON(w, r, &uc) {
		return
	}

	candidates, err := h.recommendCandidates(r.Context(), userIDFrom(r.Context()))
	if err != nil {
		writeErr(w, r, http.StatusInternalServerError, "could not load recipes", err)
		return
	}

	results := recommend.RankPantry(uc, candidates)
	// Encode as [] rather than null so clients can render without a nil check.
	if results == nil {
		results = []recommend.Result{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"results": results})
}

// recommendCandidates assembles the scoring pool: the user's own recipes plus
// the shared catalog, with every ingredient canonicalized here so the recommend
// package never sees raw ingredient text.
func (h *handlers) recommendCandidates(ctx context.Context, userID string) ([]recommend.Candidate, error) {
	mine, err := h.store.ListRecipes(ctx, userID)
	if err != nil {
		return nil, err
	}
	catalog, err := h.store.ListRecipes(ctx, CatalogUserID)
	if err != nil {
		return nil, err
	}

	out := make([]recommend.Candidate, 0, len(mine)+len(catalog))
	out = append(out, toCandidates(mine, "user")...)
	out = append(out, toCandidates(catalog, "catalog")...)
	return out, nil
}

func toCandidates(recs []Recipe, source string) []recommend.Candidate {
	out := make([]recommend.Candidate, 0, len(recs))
	for _, rec := range recs {
		ings := make([]recommend.CandidateIngredient, 0, len(rec.Ingredients))
		for _, ing := range rec.Ingredients {
			canonical, display, _ := normalizer.CanonicalItem(ing.Item)
			ings = append(ings, recommend.CandidateIngredient{
				CanonicalItem: canonical,
				Display:       display,
			})
		}
		out = append(out, recommend.Candidate{
			RecipeID:    rec.ID,
			Title:       rec.Title,
			Source:      source,
			Ingredients: ings,
		})
	}
	return out
}
```

**Note:** the module is `pantry/apps/recipe-service` (verified in `go.mod`), so the import path above is correct as written. The module targets **Go 1.25**, so the builtin `min` used in `features.go` is available.

- [ ] **Step 4: Register the route**

In `apps/recipe-service/internal/recipe/handler.go`, add one line after the `POST /grocery-list` registration inside `NewRouterWithImporter`:

```go
	mux.HandleFunc("POST /grocery-list", traced(h.groceryList))
	mux.HandleFunc("POST /recommendations/pantry", traced(h.recommendPantry))
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/recipe-service && go test ./internal/recipe/ -run TestRecommend -v`
Expected: PASS — 7 tests.

- [ ] **Step 6: Run the whole Go suite and lint**

Run: `cd apps/recipe-service && go test ./... && go vet ./... && golangci-lint run ./...`
Expected: all packages PASS, no lint output. (DB-backed tests skip without `DATABASE_URL`.)

- [ ] **Step 7: Commit**

```bash
git add apps/recipe-service/internal/recipe/recommend.go \
        apps/recipe-service/internal/recipe/recommend_test.go \
        apps/recipe-service/internal/recipe/handler.go
git commit -m "feat(recipe-service): POST /recommendations/pantry endpoint"
```

---

### Task 4: Shared TypeScript types

**Files:**
- Modify: `packages/types/src/index.ts` (append)

**Interfaces:**
- Consumes: the JSON shapes produced by Task 3.
- Produces: `PantryContextItem`, `RecommendationPreferences`, `RecommendationRequest`, `RecommendationMissingItem`, `Recommendation`, `RecommendationResponse`.

- [ ] **Step 1: Append the types**

Add to the end of `packages/types/src/index.ts`:

```ts
/** One pantry row as the recommender sees it. Mirrors Go recommend.PantryItem. */
export interface PantryContextItem {
  canonicalItem: string;
  state: "have" | "low" | "out";
  useItUp?: boolean;
}

/** Ingredient-grounded preferences. `avoidItems` is a hard filter, not a weight. */
export interface RecommendationPreferences {
  avoidItems: string[];
  likedItems: string[];
  dislikedItems: string[];
}

/** Mirrors Go recommend.UserContext. */
export interface RecommendationRequest {
  pantry: PantryContextItem[];
  preferences: RecommendationPreferences;
  affinities?: Record<string, number>;
  savedRecipeIds?: string[];
  excludeRecipeIds?: string[];
  limit?: number;
}

export interface RecommendationMissingItem {
  canonicalItem: string;
  display: string;
}

/** Mirrors Go recommend.Result. */
export interface Recommendation {
  recipeId: string;
  title: string;
  /** "generated" is reserved for a future LLM candidate provider (BL-0034). */
  source: "catalog" | "user" | "generated";
  score: number;
  reasons: string[];
  have: string[];
  missing: RecommendationMissingItem[];
}

export interface RecommendationResponse {
  results: Recommendation[];
}
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm --filter @pantry/types build 2>/dev/null || pnpm --filter @pantry/types exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/types/src/index.ts
git commit -m "feat(types): recommendation request/response contract"
```

---

### Task 5: Convex schema — real `preferences` table + `useItUp` flag

**Files:**
- Modify: `packages/convex/convex/schema.ts`

**Interfaces:**
- Produces: `preferences` table with `avoidItems`/`likedItems`/`dislikedItems`/facet fields; `pantryItems.useItUp`.

- [ ] **Step 1: Verify the `preferences` table is empty**

Dropping `data` is only safe if no row carries it — Convex validates existing rows against the new schema on push, and one stray row fails the deploy.

Run: `cd packages/convex && npx convex data preferences`
Expected: an empty table (0 documents). **If any rows exist, stop** and instead keep `data: v.optional(v.any())` in the validator, ship the rest, and remove it in a follow-up after clearing the rows.

- [ ] **Step 2: Replace the `preferences` table definition**

In `packages/convex/convex/schema.ts`, replace:

```ts
  // Per-user preferences placeholder (populated later).
  preferences: defineTable({
    userId: v.string(),
    // freeform for now; real fields arrive with the recommendations work.
    data: v.optional(v.any()),
  }).index("by_user", ["userId"]),
```

with:

```ts
  // Per-user preferences (BL-0005). Ingredient-grounded fields score TODAY;
  // the facet fields are captured but inert until recipes carry metadata
  // (BL-0030), so switching them on later is a scoring change, not a migration
  // plus a re-onboarding.
  preferences: defineTable({
    userId: v.string(),
    // Ingredient-grounded — active now. avoidItems is a HARD FILTER: a recipe
    // containing one is removed, never merely down-weighted.
    avoidItems: v.array(v.string()),
    likedItems: v.array(v.string()),
    dislikedItems: v.array(v.string()),
    // Facets — captured, inert. Selecting a diet label PRE-FILLS avoidItems
    // from a curated seed set rather than filtering by inference, so nothing is
    // ever excluded invisibly.
    dietLabels: v.optional(v.array(v.string())),
    cuisines: v.optional(v.array(v.string())),
    maxMinutes: v.optional(v.number()),
    householdSize: v.optional(v.number()),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),
```

- [ ] **Step 3: Add the `useItUp` flag to `pantryItems`**

In the same file, inside the `pantryItems` table definition, add after the `source` field:

```ts
    // "Things to use up" is a FLAG on the pantry row, not a second table — the
    // row already carries canonicalItem (so it joins to recipes for free),
    // display, and aisle, and it stays part of don't-rebuy.
    useItUp: v.optional(v.boolean()),
```

- [ ] **Step 4: Push the schema and regenerate types**

Run: `cd packages/convex && npx convex dev --once`
Expected: schema pushed, `_generated/` refreshed, no validation errors.

**Requires the running self-hosted backend.** If it is not up, bring the stack up first (`docker compose up -d`) and confirm `.env.local` has `CONVEX_SELF_HOSTED_URL` on port **3210**, not 3212.

- [ ] **Step 5: Run the Convex suite to confirm nothing regressed**

Run: `pnpm --filter @pantry/convex test`
Expected: all existing tests PASS (the new optional field breaks nothing).

- [ ] **Step 6: Commit**

```bash
git add packages/convex/convex/schema.ts packages/convex/convex/_generated/
git commit -m "feat(convex): real preferences schema + pantry useItUp flag"
```

---

### Task 6: Convex `preferences` functions

**Files:**
- Create: `packages/convex/convex/preferences.ts`
- Test: `packages/convex/convex/preferences.test.ts`

**Interfaces:**
- Consumes: the `preferences` table from Task 5.
- Produces: `api.preferences.get` (query, returns defaults when unset) and `api.preferences.set` (mutation).

**Note:** the diet→avoid-ingredients seed table lives **only** in the web component (Task 9). Do not add it here. The `set` mutation never reads it, a second copy would drift from the UI's, and an unused export fails knip in CI.

- [ ] **Step 1: Write the failing tests**

Create `packages/convex/convex/preferences.test.ts`:

```ts
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

const USER_ID = "user-a";
const identity = { subject: `${USER_ID}|session` };

describe("preferences", () => {
  it("returns empty defaults when the user has never set any", async () => {
    const t = convexTest(schema, modules);
    const prefs = await t.withIdentity(identity).query(api.preferences.get, {});
    expect(prefs).toMatchObject({ avoidItems: [], likedItems: [], dislikedItems: [] });
  });

  it("round-trips what was set", async () => {
    const t = convexTest(schema, modules);
    await t
      .withIdentity(identity)
      .mutation(api.preferences.set, { avoidItems: ["peanut"], likedItems: ["garlic"] });

    const prefs = await t.withIdentity(identity).query(api.preferences.get, {});
    expect(prefs.avoidItems).toEqual(["peanut"]);
    expect(prefs.likedItems).toEqual(["garlic"]);
  });

  it("updates in place rather than inserting a second row", async () => {
    const t = convexTest(schema, modules);
    const client = t.withIdentity(identity);
    await client.mutation(api.preferences.set, { avoidItems: ["peanut"] });
    await client.mutation(api.preferences.set, { avoidItems: ["shellfish"] });

    const rows = await t.run(async (ctx) => await ctx.db.query("preferences").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0].avoidItems).toEqual(["shellfish"]);
  });

  it("never returns another user's preferences", async () => {
    const t = convexTest(schema, modules);
    await t.withIdentity(identity).mutation(api.preferences.set, { avoidItems: ["peanut"] });

    const other = await t
      .withIdentity({ subject: "user-b|session" })
      .query(api.preferences.get, {});
    expect(other.avoidItems).toEqual([]);
  });

  it("normalizes avoid items to canonical lowercase keys", async () => {
    const t = convexTest(schema, modules);
    await t.withIdentity(identity).mutation(api.preferences.set, { avoidItems: ["  Peanut  "] });
    const prefs = await t.withIdentity(identity).query(api.preferences.get, {});
    expect(prefs.avoidItems).toEqual(["peanut"]);
  });

  it("rejects unauthenticated reads", async () => {
    const t = convexTest(schema, modules);
    await expect(t.query(api.preferences.get, {})).rejects.toThrow("Not authenticated");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @pantry/convex test preferences`
Expected: FAIL — `api.preferences` is undefined.

- [ ] **Step 3: Write the implementation**

Create `packages/convex/convex/preferences.ts`:

```ts
import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/** Ingredient keys are canonical: lowercased and trimmed, matching Go's CanonicalItem. */
const canonicalize = (items: string[] | undefined): string[] =>
  Array.from(new Set((items ?? []).map((s) => s.trim().toLowerCase()).filter(Boolean)));

const EMPTY = {
  avoidItems: [] as string[],
  likedItems: [] as string[],
  dislikedItems: [] as string[],
  dietLabels: [] as string[],
  cuisines: [] as string[],
  maxMinutes: undefined as number | undefined,
  householdSize: undefined as number | undefined,
};

export const get = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const row = await ctx.db
      .query("preferences")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    // Absent preferences are not an error — a user who has never opened
    // settings still gets recommendations, just without preference signal.
    if (row === null) return EMPTY;
    return {
      avoidItems: row.avoidItems,
      likedItems: row.likedItems,
      dislikedItems: row.dislikedItems,
      dietLabels: row.dietLabels ?? [],
      cuisines: row.cuisines ?? [],
      maxMinutes: row.maxMinutes,
      householdSize: row.householdSize,
    };
  },
});

export const set = mutation({
  args: {
    avoidItems: v.optional(v.array(v.string())),
    likedItems: v.optional(v.array(v.string())),
    dislikedItems: v.optional(v.array(v.string())),
    dietLabels: v.optional(v.array(v.string())),
    cuisines: v.optional(v.array(v.string())),
    maxMinutes: v.optional(v.number()),
    householdSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");

    const existing = await ctx.db
      .query("preferences")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();

    const next = {
      userId,
      avoidItems: canonicalize(args.avoidItems ?? existing?.avoidItems),
      likedItems: canonicalize(args.likedItems ?? existing?.likedItems),
      dislikedItems: canonicalize(args.dislikedItems ?? existing?.dislikedItems),
      dietLabels: args.dietLabels ?? existing?.dietLabels,
      cuisines: args.cuisines ?? existing?.cuisines,
      maxMinutes: args.maxMinutes ?? existing?.maxMinutes,
      householdSize: args.householdSize ?? existing?.householdSize,
      updatedAt: Date.now(),
    };

    if (existing === null) await ctx.db.insert("preferences", next);
    else await ctx.db.patch(existing._id, next);
  },
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @pantry/convex test preferences`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/convex/convex/preferences.ts packages/convex/convex/preferences.test.ts
git commit -m "feat(convex): preferences get/set with canonicalized avoid list"
```

---

### Task 7: Convex `pantry.setUseItUp`

**Files:**
- Modify: `packages/convex/convex/pantry.ts` (append a mutation)
- Modify: `packages/convex/convex/pantry.test.ts` (append tests)

**Interfaces:**
- Consumes: `pantryItems.useItUp` from Task 5.
- Produces: `api.pantry.setUseItUp({ id, useItUp })`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/convex/convex/pantry.test.ts` (inside the existing `describe("pantry", ...)` block):

```ts
  it("flags a row to use up", async () => {
    const t = convexTest(schema, modules);
    const id = await seed(t);

    await t.withIdentity(identity).mutation(api.pantry.setUseItUp, { id, useItUp: true });

    const rows = await t.withIdentity(identity).query(api.pantry.list, {});
    expect(rows[0].useItUp).toBe(true);
  });

  it("clears the use-it-up flag", async () => {
    const t = convexTest(schema, modules);
    const id = await seed(t);
    const client = t.withIdentity(identity);

    await client.mutation(api.pantry.setUseItUp, { id, useItUp: true });
    await client.mutation(api.pantry.setUseItUp, { id, useItUp: false });

    const rows = await client.query(api.pantry.list, {});
    expect(rows[0].useItUp).toBe(false);
  });

  it("refuses to flag another user's row", async () => {
    const t = convexTest(schema, modules);
    const id = await seed(t, { userId: "someone-else" });

    await expect(
      t.withIdentity(identity).mutation(api.pantry.setUseItUp, { id, useItUp: true }),
    ).rejects.toThrow("Not found");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @pantry/convex test pantry`
Expected: FAIL — `api.pantry.setUseItUp` is undefined.

- [ ] **Step 3: Write the mutation**

Append to `packages/convex/convex/pantry.ts`:

```ts
/**
 * Mark (or unmark) a pantry row as something to use up.
 *
 * This is a flag on the existing row rather than a separate "leftovers" table:
 * the row already carries the canonicalItem that joins to recipe ingredients,
 * so the recommender needs no second source of truth about what the user has.
 */
export const setUseItUp = mutation({
  args: { id: v.id("pantryItems"), useItUp: v.boolean() },
  handler: async (ctx, { id, useItUp }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const row = await ctx.db.get(id);
    if (row === null || row.userId !== userId) throw new Error("Not found");
    await ctx.db.patch(id, { useItUp, updatedAt: Date.now() });
  },
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @pantry/convex test pantry`
Expected: PASS — existing pantry tests plus the 3 new ones.

- [ ] **Step 5: Commit**

```bash
git add packages/convex/convex/pantry.ts packages/convex/convex/pantry.test.ts
git commit -m "feat(convex): pantry.setUseItUp mutation"
```

---

### Task 8: Convex `recommendations.pantry` action

**Files:**
- Create: `packages/convex/convex/recommendations.ts`
- Test: `packages/convex/convex/recommendations.integration.test.ts`

**Interfaces:**
- Consumes: `api.pantry.list` (Task 7), `api.preferences.get` (Task 6), `api.basket.list`, the Go endpoint (Task 3), the types from Task 4.
- Produces: `api.recommendations.pantry` → `Recommendation[]`.

- [ ] **Step 1: Write the action**

Create `packages/convex/convex/recommendations.ts`:

```ts
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Recommendation, RecommendationResponse } from "@pantry/types";
import { api } from "./_generated/api";
import { action } from "./_generated/server";

// How long we wait on recipe-service before giving up. Recommendations are
// additive — a slow ranker must never hang the Pantry page.
const TIMEOUT_MS = 5_000;

/**
 * Rank recipes against what the user has on hand.
 *
 * This is an ACTION, not a query, because Convex queries cannot do network I/O.
 * Results are therefore fetched rather than reactive — the caller refetches when
 * pantry contents change.
 */
export const pantry = action({
  args: {},
  handler: async (ctx): Promise<Recommendation[]> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");

    const baseUrl = process.env.RECIPE_SERVICE_URL;
    if (!baseUrl) throw new Error("RECIPE_SERVICE_URL is not set on the deployment");
    const secret = process.env.RECIPE_SERVICE_SECRET;
    if (!secret) throw new Error("RECIPE_SERVICE_SECRET is not set on the deployment");

    const [pantryRows, preferences, basket] = await Promise.all([
      ctx.runQuery(api.pantry.list, {}),
      ctx.runQuery(api.preferences.get, {}),
      ctx.runQuery(api.basket.list, {}),
    ]);

    const body = {
      pantry: pantryRows.map((row) => ({
        canonicalItem: row.canonicalItem,
        state: row.state,
        useItUp: row.useItUp ?? false,
      })),
      preferences: {
        avoidItems: preferences.avoidItems,
        likedItems: preferences.likedItems,
        dislikedItems: preferences.dislikedItems,
      },
      // Already-planned recipes are excluded outright: suggesting what is
      // already on the week's plan is noise.
      excludeRecipeIds: basket.map((b: { recipeId: string }) => b.recipeId),
      limit: 20,
    };

    const res = await fetch(`${baseUrl}/recommendations/pantry`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Service-Secret": secret,
        "X-User-Id": userId,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`recipe-service POST /recommendations/pantry failed: ${res.status}`);
    }
    const payload = (await res.json()) as RecommendationResponse;
    return payload.results ?? [];
  },
});
```

- [ ] **Step 2: Write the integration test**

Create `packages/convex/convex/recommendations.integration.test.ts`.

**No skip guard and no env setup are needed** — that is not how this repo selects integration suites. `vitest.integration.config.ts` includes only `convex/**/*.integration.test.ts`, starts a real recipe-service via `test/integration-setup.ts`, and injects `RECIPE_SERVICE_URL` / `RECIPE_SERVICE_SECRET` into the workers through `test.env`. The default unit config excludes `*.integration.test.ts`. So the filename alone routes this file correctly.

The user id comes from the identity subject up to the `|`, matching the existing file's `integration-user` convention.

```ts
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

// getAuthUserId returns the subject up to the "|" divider, so this is the user
// id "integration-user" — same convention as recipes.integration.test.ts.
const USER_ID = "integration-user";
const identity = { subject: `${USER_ID}|session` };

async function seedPantryRice(t: ReturnType<typeof convexTest>) {
  await t.run(async (ctx) =>
    ctx.db.insert("pantryItems", {
      userId: USER_ID,
      canonicalItem: "rice",
      display: "Rice",
      aisle: "pantry",
      state: "have" as const,
      source: "manual" as const,
      updatedAt: 0,
    }),
  );
}

describe("recommendations <-> recipe-service contract", () => {
  it("ranks a recipe whose ingredients are in the pantry", async () => {
    const t = convexTest(schema, modules);
    const client = t.withIdentity(identity);

    await client.action(api.recipes.create, {
      title: "Pantry Rice",
      ingredients: [{ quantity: 1, unit: "cup", item: "rice" }],
    });
    await seedPantryRice(t);

    const results = await client.action(api.recommendations.pantry, {});
    const hit = results.find((r) => r.title === "Pantry Rice");
    expect(hit).toBeDefined();
    expect(hit?.have).toEqual(["rice"]);
    expect(hit?.reasons.length).toBeGreaterThan(0);
  });

  // The contract that matters most: the hard filter survives the full round trip
  // through Convex → HTTP → Go, not just the Go unit test.
  it("never returns a recipe containing an avoided ingredient", async () => {
    const t = convexTest(schema, modules);
    const client = t.withIdentity(identity);

    await client.action(api.recipes.create, {
      title: "Peanut Rice",
      ingredients: [
        { quantity: 1, unit: "cup", item: "rice" },
        { quantity: 2, unit: "tbsp", item: "peanut" },
      ],
    });
    await seedPantryRice(t);
    await client.mutation(api.preferences.set, { avoidItems: ["peanut"] });

    const results = await client.action(api.recommendations.pantry, {});
    expect(results.map((r) => r.title)).not.toContain("Peanut Rice");
  });
});
```

- [ ] **Step 3: Run the integration test**

Run: `pnpm --filter @pantry/convex test:integration`
Expected: PASS — both new tests, alongside the existing recipe contract tests.

- [ ] **Step 4: Run the full Convex suite**

Run: `pnpm --filter @pantry/convex test`
Expected: PASS (integration tests skip without a service URL).

- [ ] **Step 5: Commit**

```bash
git add packages/convex/convex/recommendations.ts \
        packages/convex/convex/recommendations.integration.test.ts
git commit -m "feat(convex): recommendations.pantry action"
```

---

### Task 9: Web — preferences screen at `/settings`

**Files:**
- Create: `apps/web/src/components/Preferences.tsx`
- Create: `apps/web/src/components/Preferences.test.tsx`
- Create: `apps/web/src/routes/settings.tsx`

**Interfaces:**
- Consumes: `api.preferences.get` / `api.preferences.set` (Task 6).
- Owns: `DIET_SEEDS`, the single source of truth for diet→avoid-ingredient seeding. It exists here and nowhere else.
- Produces: the `/settings` route. **Not added to `NAV_ITEMS`** — the IA reserves the 5 tabs and puts settings behind a menu.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/Preferences.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Preferences } from "./Preferences";

const setPreferences = vi.fn();

vi.mock("convex/react", () => ({
  useQuery: () => ({ avoidItems: ["peanut"], likedItems: [], dislikedItems: [], dietLabels: [] }),
  useMutation: () => setPreferences,
}));

vi.mock("@pantry/convex/api", () => ({ api: { preferences: { get: "get", set: "set" } } }));

describe("Preferences", () => {
  it("shows the current avoid list", () => {
    render(<Preferences />);
    expect(screen.getByText("peanut")).toBeInTheDocument();
  });

  it("adds an ingredient to the avoid list", async () => {
    const user = userEvent.setup();
    render(<Preferences />);

    await user.type(screen.getByPlaceholderText("Ingredient to avoid"), "shellfish");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(setPreferences).toHaveBeenCalledWith(
      expect.objectContaining({ avoidItems: ["peanut", "shellfish"] }),
    );
  });

  it("removes an ingredient from the avoid list", async () => {
    const user = userEvent.setup();
    render(<Preferences />);

    await user.click(screen.getByRole("button", { name: "Remove peanut" }));

    expect(setPreferences).toHaveBeenCalledWith(expect.objectContaining({ avoidItems: [] }));
  });

  it("explains that avoided ingredients are removed, not down-ranked", () => {
    render(<Preferences />);
    expect(screen.getByText(/never suggested/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pantry/web test Preferences`
Expected: FAIL — cannot resolve `./Preferences`.

- [ ] **Step 3: Write the component**

Create `apps/web/src/components/Preferences.tsx`:

```tsx
import { api } from "@pantry/convex/api";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { useAsyncAction } from "../lib/useAsyncAction";
import { ErrorText } from "./ErrorText";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { Input } from "./ui/Input";

// The single source of truth for diet seeds. Selecting a diet PRE-FILLS the
// avoid list so the user can see and edit exactly what gets excluded.
//
// This is deliberate: filtering by INFERRING which ingredients are meat would
// produce false negatives under partial dictionary coverage — a beef recipe
// shown to someone who declared vegetarian — which destroys trust in the whole
// feature. Nothing is ever excluded invisibly.
//
// It lives here and nowhere else: the Convex `set` mutation stores whatever
// avoid list it is handed and never consults this table.
const MEAT = ["beef", "chicken", "pork", "bacon", "lamb"];
const SEAFOOD = ["fish", "shrimp", "anchovy"];
const ANIMAL_PRODUCTS = ["butter", "milk", "cream", "cheese", "parmesan", "mozzarella", "egg", "honey"];

const DIET_SEEDS: Record<string, string[]> = {
  vegetarian: [...MEAT, ...SEAFOOD],
  vegan: [...MEAT, ...SEAFOOD, ...ANIMAL_PRODUCTS],
  pescatarian: [...MEAT],
};

export function Preferences() {
  const prefs = useQuery(api.preferences.get);
  const setPreferences = useMutation(api.preferences.set);
  const { run, error } = useAsyncAction();
  const [draft, setDraft] = useState("");

  const avoidItems = prefs?.avoidItems ?? [];

  const save = (next: string[]) =>
    run(() => setPreferences({ avoidItems: Array.from(new Set(next)) }));

  const add = () => {
    const value = draft.trim().toLowerCase();
    if (!value) return;
    setDraft("");
    save([...avoidItems, value]);
  };

  return (
    <Card title="Preferences">
      <div className="flex flex-col gap-4">
        <div>
          <h3 className="text-sm font-semibold text-text">Ingredients to avoid</h3>
          <p className="mt-0.5 text-xs text-muted">
            Recipes containing these are <strong>never suggested</strong> — they're removed, not
            just ranked lower.
          </p>

          <div className="mt-2 flex gap-2">
            <Input
              placeholder="Ingredient to avoid"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  add();
                }
              }}
            />
            <Button variant="secondary" size="sm" onClick={add}>
              Add
            </Button>
          </div>

          <ul className="mt-2 flex flex-wrap gap-1.5">
            {avoidItems.map((item) => (
              <li
                key={item}
                className="flex items-center gap-1 rounded-full bg-border px-2 py-0.5 text-xs text-text"
              >
                <span>{item}</span>
                <button
                  type="button"
                  aria-label={`Remove ${item}`}
                  className="text-muted hover:text-text"
                  onClick={() => save(avoidItems.filter((i) => i !== item))}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-text">Diet</h3>
          <p className="mt-0.5 text-xs text-muted">
            Picking one fills in the avoid list above, which you can then edit.
          </p>
          <div className="mt-2 flex gap-2">
            {Object.keys(DIET_SEEDS).map((diet) => (
              <Button
                key={diet}
                variant="secondary"
                size="sm"
                onClick={() => save([...avoidItems, ...DIET_SEEDS[diet]])}
              >
                {diet}
              </Button>
            ))}
          </div>
        </div>
      </div>
      <ErrorText message={error} />
    </Card>
  );
}
```

- [ ] **Step 4: Create the route**

Create `apps/web/src/routes/settings.tsx`:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { Preferences } from "../components/Preferences";

function SettingsPage() {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-2xl font-semibold text-text">Settings</h2>
      <Preferences />
    </div>
  );
}

export const Route = createFileRoute("/settings")({ component: SettingsPage });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @pantry/web test Preferences`
Expected: PASS — 4 tests.

- [ ] **Step 6: Lint the changed files by explicit path**

Run:
```bash
pnpm exec biome check --write \
  apps/web/src/components/Preferences.tsx \
  apps/web/src/components/Preferences.test.tsx \
  apps/web/src/routes/settings.tsx
```
Expected: files formatted, no remaining diagnostics. (Biome no-ops if given the worktree root — always pass paths.)

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/Preferences.tsx \
        apps/web/src/components/Preferences.test.tsx \
        apps/web/src/routes/settings.tsx
git commit -m "feat(web): preferences screen with avoid list at /settings"
```

---

### Task 10: Web — mark pantry items to use up

**Files:**
- Modify: `apps/web/src/components/Pantry.tsx`
- Modify: `apps/web/src/components/Pantry.test.tsx`

**Interfaces:**
- Consumes: `api.pantry.setUseItUp` (Task 7).
- Produces: a per-row "Use up" toggle. Row shape gains `useItUp?: boolean`.

- [ ] **Step 1: Write the failing test**

Append to `apps/web/src/components/Pantry.test.tsx`. **Read the existing file first** — it already mocks `convex/react`; extend that mock rather than adding a second one, and reuse its existing row fixtures.

```tsx
  it("marks a row to use up", async () => {
    const user = userEvent.setup();
    render(<Pantry />);

    await user.click(screen.getByRole("button", { name: "Mark Butter to use up" }));

    expect(setUseItUp).toHaveBeenCalledWith({ id: expect.anything(), useItUp: true });
  });

  it("shows a flagged row as already marked", () => {
    render(<Pantry />);
    expect(screen.getByRole("button", { name: /Stop using up/ })).toBeInTheDocument();
  });
```

For these to work, the file's `convex/react` mock needs `setUseItUp` wired in and at least one fixture row with `useItUp: true`. Follow the existing mock's shape — it already distinguishes mutations by the `api.pantry.*` key it is called with.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pantry/web test Pantry`
Expected: FAIL — no button matching `Mark Butter to use up`.

- [ ] **Step 3: Add the toggle to the component**

In `apps/web/src/components/Pantry.tsx`, add the mutation alongside the existing ones:

```tsx
  const setUseItUp = useMutation(api.pantry.setUseItUp);
```

Then, inside the row `<li>`, insert this button between the state pill and the remove `Button`:

```tsx
                  <button
                    type="button"
                    aria-label={
                      item.useItUp
                        ? `Stop using up ${item.display}`
                        : `Mark ${item.display} to use up`
                    }
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      item.useItUp
                        ? "bg-amber-500/20 text-amber-700"
                        : "bg-border text-muted hover:text-text"
                    }`}
                    onClick={() =>
                      run(() => setUseItUp({ id: item._id, useItUp: !item.useItUp }))
                    }
                  >
                    use up
                  </button>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @pantry/web test Pantry`
Expected: PASS — existing Pantry tests plus the 2 new ones.

- [ ] **Step 5: Lint and commit**

```bash
pnpm exec biome check --write apps/web/src/components/Pantry.tsx apps/web/src/components/Pantry.test.tsx
git add apps/web/src/components/Pantry.tsx apps/web/src/components/Pantry.test.tsx
git commit -m "feat(web): mark pantry items to use up"
```

---

### Task 11: Web — "What can I make?" results

**Files:**
- Create: `apps/web/src/components/pantry/UseItUpSuggestions.tsx`
- Create: `apps/web/src/components/pantry/UseItUpSuggestions.test.tsx`
- Modify: `apps/web/src/routes/pantry.tsx`

**Interfaces:**
- Consumes: `api.recommendations.pantry` (Task 8), `api.basket.add`, the `Recommendation` type (Task 4).
- Produces: the results surface on `/pantry`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/pantry/UseItUpSuggestions.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { UseItUpSuggestions } from "./UseItUpSuggestions";

const recommend = vi.fn();
const addToBasket = vi.fn();

vi.mock("convex/react", () => ({
  useAction: () => recommend,
  useMutation: () => addToBasket,
}));
vi.mock("@pantry/convex/api", () => ({
  api: { recommendations: { pantry: "rec" }, basket: { add: "add" } },
}));

describe("UseItUpSuggestions", () => {
  it("renders results with their reasons", async () => {
    const user = userEvent.setup();
    recommend.mockResolvedValue([
      {
        recipeId: "r1",
        title: "Tomato Soup",
        source: "catalog",
        score: 0.8,
        reasons: ["Uses up: basil", "Uses 3 things you have"],
        have: ["tomato", "onion", "basil"],
        missing: [],
      },
    ]);

    render(<UseItUpSuggestions />);
    await user.click(screen.getByRole("button", { name: "What can I make?" }));

    expect(await screen.findByText("Tomato Soup")).toBeInTheDocument();
    expect(screen.getByText("Uses up: basil")).toBeInTheDocument();
  });

  it("shows a helpful empty state rather than an error when nothing scores", async () => {
    const user = userEvent.setup();
    recommend.mockResolvedValue([]);

    render(<UseItUpSuggestions />);
    await user.click(screen.getByRole("button", { name: "What can I make?" }));

    expect(await screen.findByText(/Nothing close yet/i)).toBeInTheDocument();
  });

  it("surfaces a failure without crashing the page", async () => {
    const user = userEvent.setup();
    recommend.mockRejectedValue(new Error("service down"));

    render(<UseItUpSuggestions />);
    await user.click(screen.getByRole("button", { name: "What can I make?" }));

    expect(await screen.findByText(/service down/)).toBeInTheDocument();
  });

  it("adds a suggestion to the plan", async () => {
    const user = userEvent.setup();
    recommend.mockResolvedValue([
      {
        recipeId: "r1",
        title: "Tomato Soup",
        source: "catalog",
        score: 0.8,
        reasons: [],
        have: ["tomato"],
        missing: [],
      },
    ]);

    render(<UseItUpSuggestions />);
    await user.click(screen.getByRole("button", { name: "What can I make?" }));
    await user.click(await screen.findByRole("button", { name: "Add Tomato Soup to plan" }));

    expect(addToBasket).toHaveBeenCalledWith({ recipeId: "r1", title: "Tomato Soup" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pantry/web test UseItUpSuggestions`
Expected: FAIL — cannot resolve `./UseItUpSuggestions`.

- [ ] **Step 3: Write the component**

Create `apps/web/src/components/pantry/UseItUpSuggestions.tsx`:

```tsx
import { api } from "@pantry/convex/api";
import type { Recommendation } from "@pantry/types";
import { useAction, useMutation } from "convex/react";
import { useState } from "react";
import { useAsyncAction } from "../../lib/useAsyncAction";
import { ErrorText } from "../ErrorText";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";

export function UseItUpSuggestions() {
  const recommend = useAction(api.recommendations.pantry);
  const addToBasket = useMutation(api.basket.add);
  const { run, error, pending } = useAsyncAction();
  // null = not asked yet, so the empty state only appears after a real attempt.
  const [results, setResults] = useState<Recommendation[] | null>(null);

  const ask = () =>
    run(async () => {
      const found = await recommend({});
      setResults(found);
      return found;
    });

  return (
    <Card title="Cook from what you have">
      <p className="text-sm text-muted">
        Mark things above to use up, then see what you could make with them.
      </p>

      <div className="mt-2">
        <Button variant="secondary" size="sm" onClick={ask} disabled={pending}>
          {pending ? "Looking…" : "What can I make?"}
        </Button>
      </div>

      {results !== null && results.length === 0 && (
        <p className="mt-3 text-sm text-muted">
          Nothing close yet — mark a few more items you have.
        </p>
      )}

      <ul className="mt-3 flex flex-col divide-y divide-border">
        {(results ?? []).map((r) => (
          <li key={r.recipeId} className="flex items-start justify-between gap-2 py-2">
            <div className="min-w-0">
              <p className="font-medium text-text">{r.title}</p>
              {r.reasons.length > 0 && (
                <p className="text-xs text-muted">{r.reasons.slice(0, 3).join(" · ")}</p>
              )}
              {r.missing.length > 0 && (
                <p className="text-xs text-muted">
                  Need: {r.missing.map((m) => m.display).join(", ")}
                </p>
              )}
            </div>
            <Button
              variant="secondary"
              size="sm"
              aria-label={`Add ${r.title} to plan`}
              onClick={() => run(() => addToBasket({ recipeId: r.recipeId, title: r.title }))}
            >
              Add to plan
            </Button>
          </li>
        ))}
      </ul>

      <ErrorText message={error} />
    </Card>
  );
}
```

- [ ] **Step 4: Mount it on the pantry route**

Replace the body of `apps/web/src/routes/pantry.tsx` with:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { Pantry } from "../components/Pantry";
import { UseItUpSuggestions } from "../components/pantry/UseItUpSuggestions";

function PantryPage() {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-2xl font-semibold text-text">Pantry</h2>
      <Pantry />
      <UseItUpSuggestions />
    </div>
  );
}

export const Route = createFileRoute("/pantry")({ component: PantryPage });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @pantry/web test`
Expected: PASS — the whole web suite, including 4 new `UseItUpSuggestions` tests.

- [ ] **Step 6: Lint and commit**

```bash
pnpm exec biome check --write \
  apps/web/src/components/pantry/UseItUpSuggestions.tsx \
  apps/web/src/components/pantry/UseItUpSuggestions.test.tsx \
  apps/web/src/routes/pantry.tsx
git add apps/web/src/components/pantry/ apps/web/src/routes/pantry.tsx
git commit -m "feat(web): cook-from-what-you-have suggestions on /pantry"
```

---

### Task 12: End-to-end browser test

**Files:**
- Create: `apps/web/e2e/recommendations.spec.ts`

**Interfaces:**
- Consumes: everything. This is the only test that proves the whole chain — browser → Convex action → recipe-service → scoring → back.

- [ ] **Step 1: Write the spec**

Create `apps/web/e2e/recommendations.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { createRecipeAndAddToBasket, navigateTo, signUp, uniqueSuffix } from "./helpers";

test("suggests a recipe for a pantry item marked to use up", async ({ page }) => {
  await signUp(page);

  // Build a recipe, plan it, and shop it — checking the line off is what puts
  // the ingredient in the pantry (BL-0021 inflow).
  //
  // The ingredient MUST be "garlic", not something arbitrary. This recipe ends
  // up in the basket, so it is excluded from its own results; the suggestion has
  // to come from the seeded catalog. Garlic appears in 4 of the 6 catalog
  // recipes AND is a canonical item in normalization.json. Picking an ingredient
  // absent from the catalog (rice, say) makes this test assert on a suggestion
  // that can never exist.
  const title = `Garlic Bowl ${uniqueSuffix()}`;
  await createRecipeAndAddToBasket(page, title, { quantity: "2", unit: "cloves", item: "garlic" });

  await navigateTo(page, "Plan");
  const planRow = page.getByRole("listitem").filter({ hasText: title });
  await expect(planRow).toBeVisible();
  await planRow.getByRole("button", { name: "Monday" }).click();
  await page.getByRole("button", { name: "Generate grocery list" }).click();

  await navigateTo(page, "List");
  const line = page.getByRole("listitem").filter({ hasText: /garlic/i }).first();
  await expect(line).toBeVisible();
  await line.getByRole("checkbox").check();

  // The pantry now holds garlic. Mark it to use up.
  await navigateTo(page, "Pantry");
  const pantryRow = page.getByRole("listitem").filter({ hasText: /garlic/i }).first();
  await expect(pantryRow).toBeVisible();
  await pantryRow.getByRole("button", { name: /Mark .* to use up/ }).click();

  // Ask for suggestions. The planned recipe is excluded, so a catalog recipe
  // sharing the ingredient is what should surface — assert on the reason text,
  // which proves scoring actually ran rather than a list being echoed back.
  await page.getByRole("button", { name: "What can I make?" }).click();
  await expect(page.getByText(/Uses up:|Uses \d+ things? you have|You have everything/)).toBeVisible(
    { timeout: 15_000 },
  );
});

test("never suggests a recipe containing an avoided ingredient", async ({ page }) => {
  await signUp(page);

  // This test must first prove the recipe DOES surface, then prove the avoid
  // list removes it. Asserting only the absence would pass even if the filter
  // were entirely broken — a recipe sharing nothing with the pantry is dropped
  // for zero overlap anyway, so absence on its own proves nothing.
  //
  // Getting garlic into the pantry requires the check-off flow: the Pantry
  // screen has NO manual-add affordance, so the grocery list is the only inflow.
  // That means two recipes — a "base" one we shop (and which therefore lands in
  // the basket and is excluded from results), and the peanut one we never
  // basket, so it stays eligible.
  const base = `Garlic Base ${uniqueSuffix()}`;
  await createRecipeAndAddToBasket(page, base, { quantity: "2", unit: "cloves", item: "garlic" });

  await navigateTo(page, "Plan");
  const baseRow = page.getByRole("listitem").filter({ hasText: base });
  await expect(baseRow).toBeVisible();
  await baseRow.getByRole("button", { name: "Monday" }).click();
  await page.getByRole("button", { name: "Generate grocery list" }).click();

  await navigateTo(page, "List");
  const garlicLine = page.getByRole("listitem").filter({ hasText: /garlic/i }).first();
  await expect(garlicLine).toBeVisible();
  await garlicLine.getByRole("checkbox").check();

  // The peanut recipe: two ingredient rows, added with the "+ ingredient"
  // button. Never added to the basket, so it stays an eligible candidate.
  const title = `Peanut Garlic ${uniqueSuffix()}`;
  await navigateTo(page, "Recipes");
  await page.getByPlaceholder("Title").fill(title);
  await page.getByRole("spinbutton").first().fill("2");
  await page.getByPlaceholder("unit").first().fill("cloves");
  await page.getByPlaceholder("item").first().fill("garlic");
  await page.getByRole("button", { name: "+ ingredient" }).click();
  await page.getByRole("spinbutton").last().fill("2");
  await page.getByPlaceholder("unit").last().fill("tbsp");
  await page.getByPlaceholder("item").last().fill("peanut");
  await page.getByRole("button", { name: "Create recipe" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: title })).toBeVisible();

  // BASELINE: with no avoid list, the recipe surfaces.
  await navigateTo(page, "Pantry");
  await page.getByRole("button", { name: "What can I make?" }).click();
  await expect(page.getByText(title)).toBeVisible({ timeout: 15_000 });

  // Now avoid peanut and confirm it disappears.
  await page.goto("/settings");
  await page.getByPlaceholder("Ingredient to avoid").fill("peanut");
  await page.getByRole("button", { name: "Add" }).click();
  await expect(page.getByText("peanut")).toBeVisible();

  await navigateTo(page, "Pantry");
  await page.getByRole("button", { name: "What can I make?" }).click();
  await expect(page.getByText(title)).toHaveCount(0);
});
```

**Note:** `/settings` is not in `NAV_ITEMS`, so the second test reaches it with `page.goto()`. That is safe here — no Convex mutation is in flight at that moment. Everywhere else, use `navigateTo`.

- [ ] **Step 2: Run the e2e suite**

Run: `pnpm test:e2e recommendations`
Expected: both tests PASS. This brings up the full compose stack, provisions Convex, pushes functions, and runs Playwright. Use `E2E_KEEP_STACK=1` to leave the stack up when debugging.

- [ ] **Step 3: Run every suite one final time**

```bash
pnpm test
cd apps/recipe-service && go test ./... && go vet ./... && golangci-lint run ./... && cd -
pnpm test:integration
```
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add apps/web/e2e/recommendations.spec.ts
git commit -m "test(e2e): pantry recommendations and avoid-list filtering"
```

---

### Task 13: Documentation + backlog

**Files:**
- Modify: `README.md` (one line in the architecture section)
- Modify: `docs/backlog/BL-0005-recommendations-service.md`

- [ ] **Step 1: Note the new package in the README**

In `README.md`, under the architecture bullets, extend the `apps/recipe-service` bullet:

```markdown
- **`apps/recipe-service`** — Go + Postgres. Canonical source of truth for
  recipe definitions, ingredient data, and grocery-list aggregation. Also hosts
  `internal/recommend`, a dependency-free scoring package behind
  `POST /recommendations/*` — it holds no user state; Convex passes the full
  user context per request.
```

- [ ] **Step 2: Record increment 1 as delivered**

In `docs/backlog/BL-0005-recommendations-service.md`, append to the `## Proposal` section:

```markdown
**Increment 1 (delivered):** `preferences` schema + `/settings` screen, avoid-list
hard filter, `POST /recommendations/pantry`, use-it-up flag and the
"cook from what you have" surface. `internal/recommend` is dependency-free; the
HTTP handler and candidate assembly live in `internal/recipe` because a package
owning both would be an import cycle.

**Increment 2 (next):** `/recommendations/discover`, the `recommendationEvents`
log, and derived ingredient affinities.
```

Leave `status: in-progress` — the item is not done until increment 2 ships.

- [ ] **Step 3: Commit**

```bash
git add README.md docs/backlog/BL-0005-recommendations-service.md
git commit -m "docs: record recommendations increment 1"
```

---

## Self-review notes

**Spec coverage.** Every increment-1 item in the design maps to a task: preferences schema (5, 6), `/settings` form (9), avoid-list hard filter (2, 3, 6, 9), `/recommendations/pantry` (1–3, 8), use-it-up UX (7, 10, 11). All five test layers are covered — Go unit (1, 2), Go handler (3), Convex unit (6, 7), integration (8), e2e (12). The two dedicated tests the spec singled out are `TestRankPantryRemovesAvoidedIngredients` and `TestCombineIgnoresUnavailableFeatures`. Error handling (empty state, failure surfacing) is tested in Task 11.

**Deliberately deferred to increment 2**, per the design: `/recommendations/discover`, `recommendationEvents`, affinity derivation. The `affinities` field exists in the wire contract (Task 4) and is read but always empty — the seam is built, not the feature.

**Known gap the plan cannot close.** `normalization.json` canonicalizes 5 items. `TestRecommendPantryCanonicalizesIngredients` relies on the existing `scallions → green onion` synonym; most real ingredients will not canonicalize, so coverage will read low in manual testing. This is BL-0031, and it is the top risk in the design doc — expect the feature to look thin until it lands.
