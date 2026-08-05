package recipe

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"pantry/apps/recipe-service/internal/recommend"
)

// stubGenerator is a Generator that returns whatever the test hands it, and
// records the briefs it was asked for.
type stubGenerator struct {
	mu      sync.Mutex
	briefs  []GenerationBrief
	recipes []GeneratedRecipe
	err     error
}

func (s *stubGenerator) Generate(_ context.Context, brief GenerationBrief) ([]GeneratedRecipe, error) {
	s.mu.Lock()
	s.briefs = append(s.briefs, brief)
	s.mu.Unlock()
	if s.err != nil {
		return nil, s.err
	}
	return s.recipes, nil
}

func (s *stubGenerator) calls() []GenerationBrief {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]GenerationBrief(nil), s.briefs...)
}

// genResponse is the wire shape with the generated sidecar. The existing
// recResponse deliberately does not carry it, which is itself a check that the
// old contract is unchanged.
type genResponse struct {
	Results []struct {
		RecipeID string `json:"recipeId"`
		Title    string `json:"title"`
		Source   string `json:"source"`
	} `json:"results"`
	Generated []GeneratedRecipe `json:"generated"`
}

func newGeneratingServer(t *testing.T, gen Generator) (*httptest.Server, Store) {
	t.Helper()
	store := NewMemoryStore()
	srv := httptest.NewServer(NewRouterWithImporter(store, testSecret, nil, WithGenerator(gen)))
	t.Cleanup(srv.Close)
	return srv, store
}

func postGenerating(t *testing.T, srv string, body any) genResponse {
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
	var out genResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	return out
}

// pantryOf is a UserContext with the given canonical items on hand.
func pantryOf(items ...string) recommend.UserContext {
	uc := recommend.UserContext{}
	for _, item := range items {
		uc.Pantry = append(uc.Pantry, recommend.PantryItem{CanonicalItem: item, State: "have"})
	}
	return uc
}

// ── The path that will actually run ─────────────────────────────────────────

// No key means no generator, which must mean EXACTLY today's behaviour: corpus
// results, no errors, and a `generated` array that is empty rather than null.
func TestRecommendPantryWithoutGeneratorIsCorpusOnly(t *testing.T) {
	srv, store := newTestServer(t)
	if err := store.UpsertRecipe(context.Background(), Recipe{
		ID: "cat-rice", UserID: CatalogUserID, Title: "Rice Bowl",
		Ingredients: []Ingredient{{Quantity: 1, Unit: "cup", Item: "rice"}},
	}); err != nil {
		t.Fatalf("upsert: %v", err)
	}

	got := postGenerating(t, srv.URL, pantryOf("rice"))

	if len(got.Results) != 1 || got.Results[0].RecipeID != "cat-rice" {
		t.Fatalf("results = %+v, want just the catalog recipe", got.Results)
	}
	if got.Results[0].Source != "catalog" {
		t.Errorf("source = %q, want catalog", got.Results[0].Source)
	}
	// Non-nil: a nil Go slice serializes to `null`, and a client reading
	// `.length` off it throws.
	if got.Generated == nil {
		t.Error("generated = null, want []")
	}
	if len(got.Generated) != 0 {
		t.Errorf("generated = %+v, want empty without a configured generator", got.Generated)
	}
}

// A generator that fails must be indistinguishable from no generator at all.
func TestRecommendPantryGeneratorFailureDegradesSilently(t *testing.T) {
	gen := &stubGenerator{err: errors.New("upstream is down")}
	srv, store := newGeneratingServer(t, gen)
	if err := store.UpsertRecipe(context.Background(), Recipe{
		ID: "cat-rice", UserID: CatalogUserID, Title: "Rice Bowl",
		Ingredients: []Ingredient{{Quantity: 1, Unit: "cup", Item: "rice"}},
	}); err != nil {
		t.Fatalf("upsert: %v", err)
	}

	got := postGenerating(t, srv.URL, pantryOf("rice"))

	if len(gen.calls()) != 1 {
		t.Fatalf("generator calls = %d, want 1", len(gen.calls()))
	}
	if len(got.Results) != 1 || got.Results[0].RecipeID != "cat-rice" {
		t.Fatalf("results = %+v, want the corpus result to survive the failure", got.Results)
	}
	if len(got.Generated) != 0 {
		t.Errorf("generated = %+v, want empty", got.Generated)
	}
}

// ── The safety property ─────────────────────────────────────────────────────

// The non-negotiable one. A generated recipe enters the same pool and is
// filtered by the same hard avoid-list pre-filter, INCLUDING the allergen
// families of BL-0052: an avoid entry for "peanut" removes a generated recipe
// whose ingredient line says "creamy peanut butter", even though no exact
// canonical key matches. Prompt compliance is not the mechanism.
func TestRecommendPantryGeneratedCandidateCannotBypassAvoidList(t *testing.T) {
	gen := &stubGenerator{recipes: []GeneratedRecipe{
		{
			Title: "Peanut Noodles",
			Ingredients: []Ingredient{
				{Quantity: 8, Unit: "oz", Item: "rice noodles"},
				{Quantity: 2, Unit: "tbsp", Item: "creamy peanut butter"},
			},
		},
		{
			Title: "Garlic Rice",
			Ingredients: []Ingredient{
				{Quantity: 1, Unit: "cup", Item: "rice"},
				{Quantity: 2, Unit: "cloves", Item: "garlic"},
			},
		},
	}}
	srv, _ := newGeneratingServer(t, gen)

	uc := pantryOf("rice", "garlic")
	uc.Preferences.AvoidItems = []string{"peanut"}

	got := postGenerating(t, srv.URL, uc)

	for _, r := range got.Results {
		if strings.Contains(strings.ToLower(r.Title), "peanut") {
			t.Fatalf("an avoided generated recipe reached the results: %+v", r)
		}
	}
	// And it must not reach the client as a persistable draft either: a draft
	// the user could accept is as dangerous as a result they could see.
	for _, d := range got.Generated {
		if strings.Contains(strings.ToLower(d.Title), "peanut") {
			t.Fatalf("an avoided generated recipe was returned as a draft: %+v", d)
		}
	}
	if len(got.Generated) != 1 || got.Generated[0].Title != "Garlic Rice" {
		t.Fatalf("generated = %+v, want only the safe recipe", got.Generated)
	}
}

// ── Gating and bounds ───────────────────────────────────────────────────────

// Generation is not on the hot path. A corpus that already answered the question
// must not spend a model call.
func TestRecommendPantryDoesNotGenerateWhenCorpusIsRich(t *testing.T) {
	gen := &stubGenerator{}
	srv, store := newGeneratingServer(t, gen)
	for _, id := range []string{"cat-a", "cat-b", "cat-c"} {
		if err := store.UpsertRecipe(context.Background(), Recipe{
			ID: id, UserID: CatalogUserID, Title: "Rice " + id,
			Ingredients: []Ingredient{{Quantity: 1, Unit: "cup", Item: "rice"}},
		}); err != nil {
			t.Fatalf("upsert: %v", err)
		}
	}

	got := postGenerating(t, srv.URL, pantryOf("rice"))

	if len(got.Results) != 3 {
		t.Fatalf("results = %d, want the 3 corpus recipes", len(got.Results))
	}
	if calls := gen.calls(); len(calls) != 0 {
		t.Fatalf("generator was called %d times for a corpus that was not thin", len(calls))
	}
}

// An empty pantry is nothing to generate FROM. "What can I make with what I
// have" has no content when the answer is "nothing", and inventing dinner from
// thin air spends money on a suggestion the catalog already offers.
func TestRecommendPantryDoesNotGenerateWithAnEmptyPantry(t *testing.T) {
	gen := &stubGenerator{}
	srv, _ := newGeneratingServer(t, gen)

	got := postGenerating(t, srv.URL, recommend.UserContext{})

	if len(got.Results) != 0 || len(got.Generated) != 0 {
		t.Fatalf("got %+v, want nothing", got)
	}
	if calls := gen.calls(); len(calls) != 0 {
		t.Fatalf("generator was called %d times with an empty pantry", len(calls))
	}
}

// A model that overshoots is bounded here, not trusted.
func TestGeneratedCandidatesAreBounded(t *testing.T) {
	drafts := make([]GeneratedRecipe, 0, maxGeneratedRecipes+3)
	for i := 0; i < maxGeneratedRecipes+3; i++ {
		drafts = append(drafts, GeneratedRecipe{
			Title:       "Dish",
			Ingredients: []Ingredient{{Quantity: 1, Unit: "cup", Item: "rice"}},
		})
	}
	got := validGenerated(drafts)
	if len(got) != maxGeneratedRecipes {
		t.Fatalf("kept %d drafts, want %d", len(got), maxGeneratedRecipes)
	}
}

// Untitled and ingredient-less drafts cannot be ranked or saved; the ones that
// survive get a synthetic id that names no row.
func TestValidGeneratedDropsUnusableDraftsAndAssignsIDs(t *testing.T) {
	got := validGenerated([]GeneratedRecipe{
		{Title: "  ", Ingredients: []Ingredient{{Item: "rice"}}},
		{Title: "No Ingredients"},
		{Title: " Real Dish ", Ingredients: []Ingredient{{Item: "rice"}}},
	})
	if len(got) != 1 {
		t.Fatalf("kept %d drafts, want 1: %+v", len(got), got)
	}
	if got[0].Title != "Real Dish" {
		t.Errorf("title = %q, want it trimmed", got[0].Title)
	}
	if !strings.HasPrefix(got[0].RecipeID, generatedIDPrefix) {
		t.Errorf("recipeId = %q, want the %q prefix", got[0].RecipeID, generatedIDPrefix)
	}
	// Never null on the wire.
	if got[0].Steps == nil {
		t.Error("steps = nil, want []")
	}
}

// ── The brief ───────────────────────────────────────────────────────────────

func TestBriefFromSeparatesUseItUpAndDropsWhatYouRanOutOf(t *testing.T) {
	uc := recommend.UserContext{
		Pantry: []recommend.PantryItem{
			{CanonicalItem: "spinach", State: "have", UseItUp: true},
			{CanonicalItem: "rice", State: "have"},
			{CanonicalItem: "garlic", State: "low"},
			{CanonicalItem: "butter", State: "out"},
		},
		Preferences: recommend.Preferences{AvoidItems: []string{"peanut"}},
	}

	brief, ok := briefFrom(uc)
	if !ok {
		t.Fatal("briefFrom said there was nothing to generate from")
	}
	if len(brief.UseItUp) != 1 || brief.UseItUp[0] != "spinach" {
		t.Errorf("useItUp = %v, want [spinach]", brief.UseItUp)
	}
	// "low" still means you have some; "out" means you do not.
	want := []string{"garlic", "rice"}
	if len(brief.Have) != len(want) {
		t.Fatalf("have = %v, want %v", brief.Have, want)
	}
	for i, w := range want {
		if brief.Have[i] != w {
			t.Fatalf("have = %v, want %v (sorted)", brief.Have, want)
		}
	}
	if len(brief.Avoid) != 1 || brief.Avoid[0] != "peanut" {
		t.Errorf("avoid = %v, want [peanut]", brief.Avoid)
	}
	if brief.Count != maxGeneratedRecipes {
		t.Errorf("count = %d, want %d", brief.Count, maxGeneratedRecipes)
	}
}

func TestBriefFromCapsPantrySizeWithoutDroppingUseItUp(t *testing.T) {
	uc := recommend.UserContext{}
	for i := 0; i < maxBriefItems*2; i++ {
		uc.Pantry = append(uc.Pantry, recommend.PantryItem{
			CanonicalItem: string(rune('a'+i%26)) + string(rune('a'+i/26)), State: "have",
		})
	}
	uc.Pantry = append(uc.Pantry, recommend.PantryItem{CanonicalItem: "spinach", State: "have", UseItUp: true})

	brief, ok := briefFrom(uc)
	if !ok {
		t.Fatal("briefFrom returned not-ok for a full pantry")
	}
	if total := len(brief.Have) + len(brief.UseItUp); total > maxBriefItems {
		t.Errorf("brief carried %d items, want at most %d", total, maxBriefItems)
	}
	if len(brief.UseItUp) != 1 {
		t.Errorf("useItUp = %v, want the flagged item to survive the cap", brief.UseItUp)
	}
}

func TestBriefFromRejectsAPantryOfOnlyOutItems(t *testing.T) {
	uc := recommend.UserContext{Pantry: []recommend.PantryItem{
		{CanonicalItem: "butter", State: "out"},
	}}
	if _, ok := briefFrom(uc); ok {
		t.Error("briefFrom accepted a pantry with nothing actually in it")
	}
}

// ── Ranking parity ──────────────────────────────────────────────────────────

// A generated candidate is scored by the same features as everything else, so it
// carries the same explanations — reasons, have, and missing all populated from
// the same match. Nothing about it is special-cased in the ranker.
func TestGeneratedCandidateIsRankedLikeAnyOther(t *testing.T) {
	gen := &stubGenerator{recipes: []GeneratedRecipe{{
		Title: "Garlic Fried Rice",
		Ingredients: []Ingredient{
			{Quantity: 1, Unit: "cup", Item: "rice"},
			{Quantity: 2, Unit: "cloves", Item: "garlic"},
			{Quantity: 1, Unit: "tbsp", Item: "soy sauce"},
		},
	}}}
	srv, _ := newGeneratingServer(t, gen)

	buf, err := json.Marshal(pantryOf("rice", "garlic"))
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	resp := doAuth(t, http.MethodPost, srv.URL+"/recommendations/pantry", bytes.NewReader(buf))
	defer resp.Body.Close()
	var out struct {
		Results []struct {
			RecipeID string   `json:"recipeId"`
			Source   string   `json:"source"`
			Reasons  []string `json:"reasons"`
			Have     []string `json:"have"`
			Missing  []struct {
				CanonicalItem string `json:"canonicalItem"`
			} `json:"missing"`
		} `json:"results"`
		Generated []GeneratedRecipe `json:"generated"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatalf("decode: %v", err)
	}

	if len(out.Results) != 1 {
		t.Fatalf("results = %+v, want the generated candidate", out.Results)
	}
	r := out.Results[0]
	if r.Source != SourceGenerated {
		t.Errorf("source = %q, want %q — the UI labels from this", r.Source, SourceGenerated)
	}
	if len(r.Have) != 2 {
		t.Errorf("have = %v, want the two pantry hits", r.Have)
	}
	if len(r.Missing) != 1 || r.Missing[0].CanonicalItem != "soy sauce" {
		t.Errorf("missing = %+v, want [soy sauce]", r.Missing)
	}
	if len(r.Reasons) == 0 {
		t.Error("reasons = [], want the same explanations a corpus recipe gets")
	}
	// The draft comes back so accepting it does not need a second model call,
	// and its id joins to the result.
	if len(out.Generated) != 1 || out.Generated[0].RecipeID != r.RecipeID {
		t.Fatalf("generated = %+v, want one draft keyed to %q", out.Generated, r.RecipeID)
	}
	if len(out.Generated[0].Ingredients) != 3 {
		t.Errorf("draft ingredients = %+v, want all three so it can be persisted verbatim",
			out.Generated[0].Ingredients)
	}
}

// A generated candidate that shares nothing with the pantry is dropped by the
// same unmatched rule the corpus obeys — being invented buys no exemption.
func TestGeneratedCandidateObeysTheUnmatchedRule(t *testing.T) {
	gen := &stubGenerator{recipes: []GeneratedRecipe{{
		Title:       "Beef Wellington",
		Ingredients: []Ingredient{{Quantity: 1, Unit: "lb", Item: "beef tenderloin"}},
	}}}
	srv, _ := newGeneratingServer(t, gen)

	got := postGenerating(t, srv.URL, pantryOf("rice"))

	if len(got.Results) != 0 {
		t.Fatalf("results = %+v, want the unmatched generated recipe dropped", got.Results)
	}
	if len(got.Generated) != 0 {
		t.Fatalf("generated = %+v, want no draft for a dropped candidate", got.Generated)
	}
}
