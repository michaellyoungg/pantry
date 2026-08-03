package nutrition

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// Recorded FDC responses. The client is tested against these rather than the
// live API, so CI needs no api.data.gov key.
const (
	garlicSearchJSON = `{"foods":[
	  {"fdcId":169230,"description":"Garlic, raw","dataType":"SR Legacy","score":250.1},
	  {"fdcId":168581,"description":"Garlic bread, frozen","dataType":"SR Legacy","score":180.0},
	  {"fdcId":170000,"description":"Spices, garlic powder","dataType":"SR Legacy","score":190.0}
	]}`

	garlicFoodJSON = `{
	  "fdcId":169230,
	  "description":"Garlic, raw",
	  "foodNutrients":[
	    {"nutrient":{"id":1008,"name":"Energy","unitName":"KCAL"},"amount":149},
	    {"nutrient":{"id":1003,"name":"Protein","unitName":"G"},"amount":6.36},
	    {"nutrient":{"id":1093,"name":"Sodium, Na","unitName":"MG"},"amount":17},
	    {"nutrient":{"id":0,"name":"bogus","unitName":""},"amount":99}
	  ],
	  "foodPortions":[
	    {"amount":1,"gramWeight":3,"modifier":"clove","measureUnit":{"name":"undetermined"},"portionDescription":"1 clove"},
	    {"amount":1,"gramWeight":136,"modifier":"","measureUnit":{"name":"cup"},"portionDescription":"1 cup"},
	    {"amount":3,"gramWeight":8.4,"modifier":"tsp","measureUnit":{"name":"undetermined"},"portionDescription":"3 tsp"},
	    {"amount":1,"gramWeight":0,"modifier":"sliver","measureUnit":{"name":"undetermined"},"portionDescription":"1 sliver"},
	    {"amount":1,"gramWeight":150,"modifier":"","measureUnit":{"name":"undetermined"},"portionDescription":"undetermined"}
	  ]
	}`
)

func fdcTestServer(t *testing.T, search, food string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("api_key") == "" {
			t.Errorf("request without an api_key: %s", r.URL)
		}
		w.Header().Set("Content-Type", "application/json")
		if strings.HasPrefix(r.URL.Path, "/foods/search") {
			_, _ = w.Write([]byte(search))
			return
		}
		_, _ = w.Write([]byte(food))
	}))
}

func newTestFDC(t *testing.T, srv *httptest.Server) *FDCProvider {
	t.Helper()
	p := NewFDCProvider("test-key")
	if p == nil {
		t.Fatal("NewFDCProvider returned nil for a non-empty key")
	}
	p.baseURL = srv.URL
	return p
}

func TestFDCLookup(t *testing.T) {
	srv := fdcTestServer(t, garlicSearchJSON, garlicFoodJSON)
	defer srv.Close()

	food, ok, err := newTestFDC(t, srv).Lookup(context.Background(), "garlic")
	if err != nil || !ok {
		t.Fatalf("Lookup: ok=%v err=%v", ok, err)
	}

	if food.FDCID != 169230 || food.Description != "Garlic, raw" {
		t.Errorf("matched %d %q, want the raw garlic entry over the bread and the powder", food.FDCID, food.Description)
	}
	if food.Source != SourceFDC {
		t.Errorf("Source = %q, want %q", food.Source, SourceFDC)
	}
	if food.MatchConfidence < 0.9 {
		t.Errorf("MatchConfidence = %v, want a high score for an exact head match", food.MatchConfidence)
	}

	wantNutrients := map[string]float64{"1008": 149, "1003": 6.36, "1093": 17}
	for id, want := range wantNutrients {
		if food.Nutrients[id] != want {
			t.Errorf("nutrient %s = %v, want %v", id, food.Nutrients[id], want)
		}
	}
	if _, present := food.Nutrients["0"]; present {
		t.Error("a nutrient with no id was kept")
	}

	// Portions: gramWeight is for `amount` of the measure, so the 3-tsp row is
	// 2.8 g each. The zero-weight and measureless rows are dropped.
	wantPortions := map[string]float64{"clove": 3, "cup": 136, "tsp": 2.8}
	for key, want := range wantPortions {
		if got := food.Portions[key]; got != want {
			t.Errorf("portion %q = %v, want %v", key, got, want)
		}
	}
	if len(food.Portions) != len(wantPortions) {
		t.Errorf("portions = %v, want exactly %v", food.Portions, wantPortions)
	}
}

func TestFDCLookupNoUsableMatch(t *testing.T) {
	srv := fdcTestServer(t, `{"foods":[]}`, `{}`)
	defer srv.Close()

	if _, ok, err := newTestFDC(t, srv).Lookup(context.Background(), "sumac"); ok || err != nil {
		t.Errorf("got ok=%v err=%v, want a clean miss", ok, err)
	}
}

func TestFDCLookupEmptyQuery(t *testing.T) {
	srv := fdcTestServer(t, garlicSearchJSON, garlicFoodJSON)
	defer srv.Close()

	if _, ok, err := newTestFDC(t, srv).Lookup(context.Background(), "  "); ok || err != nil {
		t.Errorf("got ok=%v err=%v, want a clean miss without a request", ok, err)
	}
}

// The 1,000 req/hr limit must degrade to "unresolved", never to an error — a
// recipe page is still worth serving with a gap in it.
func TestFDCRateLimitDegradesRatherThanFailing(t *testing.T) {
	var hits int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		hits++
		w.Header().Set("Retry-After", "60")
		w.WriteHeader(http.StatusTooManyRequests)
	}))
	defer srv.Close()

	now := time.Date(2026, 8, 3, 12, 0, 0, 0, time.UTC)
	p := newTestFDC(t, srv)
	p.now = func() time.Time { return now }

	if _, ok, err := p.Lookup(context.Background(), "garlic"); ok || err != nil {
		t.Fatalf("got ok=%v err=%v, want a clean miss", ok, err)
	}
	// Subsequent lookups inside the window must not even reach the API.
	if _, ok, err := p.Lookup(context.Background(), "flour"); ok || err != nil {
		t.Fatalf("during cooldown: ok=%v err=%v", ok, err)
	}
	if hits != 1 {
		t.Errorf("hit the API %d times, want 1 — the cooldown was not honoured", hits)
	}

	// ...and once the window passes, lookups resume.
	now = now.Add(61 * time.Second)
	if _, _, err := p.Lookup(context.Background(), "garlic"); err != nil {
		t.Fatalf("after cooldown: %v", err)
	}
	if hits != 2 {
		t.Errorf("hit the API %d times after the cooldown expired, want 2", hits)
	}
}

func TestFDCServerErrorIsAnError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	if _, ok, err := newTestFDC(t, srv).Lookup(context.Background(), "garlic"); ok || err == nil {
		t.Errorf("got ok=%v err=%v, want the failure surfaced to the caller", ok, err)
	}
}

// No key means no provider: the caller falls back to the snapshot alone rather
// than making unauthenticated calls that will 403.
func TestNewFDCProviderRequiresAKey(t *testing.T) {
	for _, key := range []string{"", "   "} {
		if p := NewFDCProvider(key); p != nil {
			t.Errorf("NewFDCProvider(%q) = %v, want nil", key, p)
		}
	}
}

func TestMatchConfidence(t *testing.T) {
	tests := []struct {
		query, description, dataType string
		wantAtLeast, wantAtMost      float64
	}{
		{"garlic", "Garlic, raw", "SR Legacy", 0.9, 1},
		{"garlic", "Spices, garlic powder", "SR Legacy", 0.6, 0.75},
		{"garlic", "Garlic bread, frozen", "SR Legacy", 0.75, 0.9},
		{"chicken breast", "Chicken, broilers or fryers, breast, meat only, raw", "Foundation", 0.6, 0.8},
		// A head-word match ("Wheat flour" for "flour") is strong on its own.
		{"flour", "Wheat flour, white, all-purpose", "Foundation", 0.75, 0.9},
		// Branded entries are specific products with no household portions.
		{"garlic", "Garlic, raw", "Branded", 0.75, 0.85},
		{"garlic", "Beef, ground, raw", "SR Legacy", 0, 0.1},
		{"", "Garlic, raw", "SR Legacy", 0, 0},
	}
	for _, tt := range tests {
		got := matchConfidence(tt.query, tt.description, tt.dataType)
		if got < tt.wantAtLeast || got > tt.wantAtMost {
			t.Errorf("matchConfidence(%q, %q, %q) = %v, want %v..%v",
				tt.query, tt.description, tt.dataType, got, tt.wantAtLeast, tt.wantAtMost)
		}
	}
}

// "corn" must not match "cornstarch" — a substring match here silently swaps one
// food's nutrition for another's.
func TestContainsWordRespectsBoundaries(t *testing.T) {
	if containsWord("cornstarch, unmodified", "corn") {
		t.Error(`"cornstarch" matched the word "corn"`)
	}
	if !containsWord("corn, sweet, yellow, raw", "corn") {
		t.Error(`"corn, sweet" did not match the word "corn"`)
	}
	if !containsWord("chicken, broilers, breast, raw", "breast") {
		t.Error("multi-token haystack missed a single-token needle")
	}
	if !containsWord("wheat flour, white", "wheat flour") {
		t.Error("multi-token needle did not match")
	}
}

func TestPortionKeyOfPrefersARealMeasure(t *testing.T) {
	tests := []struct {
		measureUnit, modifier, description, want string
	}{
		{"cup", "", "1 cup", "cup"},
		{"undetermined", "clove", "1 clove", "clove"},
		{"undetermined", "", "1 medium", "medium"},
		{"undetermined", "", "undetermined", ""},
		{"", "", "", ""},
	}
	for _, tt := range tests {
		if got := portionKeyOf(tt.measureUnit, tt.modifier, tt.description); got != tt.want {
			t.Errorf("portionKeyOf(%q,%q,%q) = %q, want %q", tt.measureUnit, tt.modifier, tt.description, got, tt.want)
		}
	}
}
