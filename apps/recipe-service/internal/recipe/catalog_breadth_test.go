package recipe

import "testing"

// The catalog's job is to be a corpus, not a demo fixture (BL-0002).
//
// Discovery search, the filter chips, the recommendation ranker and "suggest my
// week" all discriminate BETWEEN recipes. On six entries they have nothing to
// discriminate with: every filter returns almost everything, and every ranking
// is a tie. So the properties worth guarding here are about the shape of the
// SET, not about any one recipe — the tests below fail when the corpus stops
// being able to tell recipes apart, which is the failure mode that silently
// degrades four shipped features at once.

// minCatalogRecipes is the floor the discovery surfaces need. It is deliberately
// well under the current count: this is a guard against the catalog collapsing
// back to a fixture, not a target to hit exactly.
const minCatalogRecipes = 40

func TestCatalogIsLargeEnoughToRankAndFilter(t *testing.T) {
	recs, err := LoadCatalog()
	if err != nil {
		t.Fatalf("LoadCatalog: %v", err)
	}
	if len(recs) < minCatalogRecipes {
		t.Fatalf("catalog has %d recipes, want at least %d — below this the filters and the ranker have nothing to discriminate between", len(recs), minCatalogRecipes)
	}
}

// Every entry states a yield. Nil servings is legal on a Recipe — a hand-entered
// one may genuinely not know — but a curated entry has no excuse, and the
// planner's per-serving nutrition divides by this. Without it a recipe
// contributes to a week's totals while showing nothing per plate (BL-0035).
func TestCatalogEveryEntryStatesItsServings(t *testing.T) {
	recs, err := LoadCatalog()
	if err != nil {
		t.Fatalf("LoadCatalog: %v", err)
	}
	for _, r := range recs {
		if r.Servings == nil {
			t.Errorf("catalog recipe %q has no servings; per-serving nutrition cannot be computed for it", r.ID)
			continue
		}
		if *r.Servings < 1 {
			t.Errorf("catalog recipe %q has servings %d, want at least 1", r.ID, *r.Servings)
		}
	}
}

// A curated entry may leave sourceUrl unset — most are hand-written and a
// fabricated attribution is worse than none — but a NON-empty one has to be a
// real link, because the UI renders it and re-import feeds it back to the
// fetcher. parseCatalog enforces this; this asserts the shipped file complies.
func TestCatalogSourceURLsAreAbsentOrUsable(t *testing.T) {
	recs, err := LoadCatalog()
	if err != nil {
		t.Fatalf("LoadCatalog: %v", err)
	}
	for _, r := range recs {
		if r.SourceURL == "" {
			continue
		}
		if _, err := normSourceURL(r.SourceURL); err != nil {
			t.Errorf("catalog recipe %q sourceUrl %q: %v", r.ID, r.SourceURL, err)
		}
	}
}

// The cook-time filter offers "under 15 / 30 / 60 minutes" (see the web app's
// COOK_TIME_BUCKETS). A bucket with nothing in it is a chip that returns an
// empty page, so the corpus has to populate all of them AND have entries above
// the top bucket, or "under 1 hour" is indistinguishable from no filter at all.
func TestCatalogPopulatesEveryCookTimeBucket(t *testing.T) {
	recs, err := LoadCatalog()
	if err != nil {
		t.Fatalf("LoadCatalog: %v", err)
	}
	buckets := map[string]int{}
	for _, r := range recs {
		if r.TotalMinutes == nil {
			continue
		}
		switch m := *r.TotalMinutes; {
		case m <= 15:
			buckets["<=15"]++
		case m <= 30:
			buckets["<=30"]++
		case m <= 60:
			buckets["<=60"]++
		default:
			buckets[">60"]++
		}
	}
	for _, b := range []string{"<=15", "<=30", "<=60", ">60"} {
		if buckets[b] == 0 {
			t.Errorf("no catalog recipe falls in the %s cook-time bucket; that filter chip returns an empty page", b)
		}
	}
}

// Cuisine is the other filter axis. One or two cuisines makes the chip row
// decorative, and gives the ranker's cuisine-affinity feature (BL-0030) nothing
// to prefer.
func TestCatalogSpansManyCuisines(t *testing.T) {
	recs, err := LoadCatalog()
	if err != nil {
		t.Fatalf("LoadCatalog: %v", err)
	}
	cuisines := map[string]int{}
	for _, r := range recs {
		if r.Cuisine != "" {
			cuisines[r.Cuisine]++
		}
	}
	const want = 10
	if len(cuisines) < want {
		t.Errorf("catalog spans %d cuisines (%v), want at least %d", len(cuisines), cuisines, want)
	}
}

// Methods and equipment are what BL-0042's prep rules and BL-0043's "can I make
// this?" key on. A corpus that only ever bakes exercises one rule and makes
// every equipment answer identical.
func TestCatalogSpansManyCookingMethods(t *testing.T) {
	recs, err := LoadCatalog()
	if err != nil {
		t.Fatalf("LoadCatalog: %v", err)
	}
	methods := map[string]int{}
	for _, r := range recs {
		for _, m := range r.Methods {
			methods[m]++
		}
	}
	const want = 10
	if len(methods) < want {
		t.Errorf("catalog uses %d cooking methods (%v), want at least %d", len(methods), methods, want)
	}
}

// Diet tags are how the UI groups its diet chips. A user filtering to vegan
// needs more than a token entry or the filter is a dead end.
func TestCatalogHasARealSelectionForEachDietTag(t *testing.T) {
	recs, err := LoadCatalog()
	if err != nil {
		t.Fatalf("LoadCatalog: %v", err)
	}
	counts := map[string]int{}
	for _, r := range recs {
		for _, tag := range r.Tags {
			counts[tag]++
		}
	}
	const want = 4
	for _, diet := range []string{"vegan", "vegetarian", "dairy-free", "gluten-free"} {
		if counts[diet] < want {
			t.Errorf("catalog has %d %q recipes, want at least %d — fewer makes that diet filter a dead end", counts[diet], diet, want)
		}
	}
}
