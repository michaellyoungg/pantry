package recipe

import (
	"encoding/json"
	"net/http"
	"slices"
	"strings"
	"testing"

	"pantry/apps/recipe-service/internal/recommend"
)

func resolveAvoid(t *testing.T, raw string) AvoidResolution {
	t.Helper()
	res, ok := normalizer.ResolveAvoid(raw)
	if !ok {
		t.Fatalf("ResolveAvoid(%q) returned nothing", raw)
	}
	return res
}

// The bug in one test: what the user types is not what the dictionary stores,
// and an entry stored as typed matches no canonical item at all.
func TestResolveAvoid_CanonicalizesSynonymsAndPlurals(t *testing.T) {
	for _, tc := range []struct{ input, want string }{
		{"scallion", "green onion"},
		{"Scallions", "green onion"},
		{"  Tomatoes  ", "tomato"},
		{"garbanzo beans", "chickpea"},
	} {
		got := resolveAvoid(t, tc.input)
		if got.CanonicalItem != tc.want || got.Kind != AvoidKindItem {
			t.Errorf("ResolveAvoid(%q) = %q (%s), want %q (item)",
				tc.input, got.CanonicalItem, got.Kind, tc.want)
		}
		if want := strings.TrimSpace(tc.input); got.Input != want {
			t.Errorf("input echo = %q, want %q — the client needs it to say what changed",
				got.Input, want)
		}
	}
}

// An entry that matches nothing is the failure this endpoint exists to expose.
// It still resolves — the entry is storable — but it is named as unknown rather
// than handed back looking like any other stored ingredient.
func TestResolveAvoid_NamesEntriesThatMatchNothing(t *testing.T) {
	got := resolveAvoid(t, "Unobtainium")
	if got.Kind != AvoidKindUnknown {
		t.Fatalf("kind = %q, want unknown", got.Kind)
	}
	if got.CanonicalItem != "unobtainium" {
		t.Errorf("canonicalItem = %q, want the normalized text so it survives to be "+
			"re-resolved when the dictionary learns the word", got.CanonicalItem)
	}
	if len(got.Members) != 0 || len(got.Families) != 0 {
		t.Errorf("unknown entry claimed structure: %+v", got)
	}
}

func TestResolveAvoid_EmptyEntriesAreDropped(t *testing.T) {
	if _, ok := normalizer.ResolveAvoid("   "); ok {
		t.Fatal("blank entry resolved; it names nothing and must not be stored")
	}
}

// Allergen families beat the identically-named item, and report what they cover.
func TestResolveAvoid_PrefersTheAllergenFamilyOverTheSameNamedItem(t *testing.T) {
	got := resolveAvoid(t, "Peanuts")
	if got.Kind != AvoidKindAllergen || got.CanonicalItem != "peanut" {
		t.Fatalf("peanuts -> %+v, want the peanut allergen family", got)
	}
	if !slices.Contains(got.Members, "Peanut butter") {
		t.Errorf("members = %v, want peanut butter listed — a family the user did not "+
			"hand-pick has to be inspectable", got.Members)
	}
}

func TestResolveAvoid_FamilyNamesResolveThroughPluralsAndAliases(t *testing.T) {
	for _, tc := range []struct{ input, want string }{
		{"peanut", "peanut"},
		{"groundnuts", "peanut"},
		{"tree nuts", "tree nut"},
		{"dairy", "milk"},
		{"milk", "milk"},
		{"soybeans", "soy"},
		{"shellfish", "shellfish"},
	} {
		got := resolveAvoid(t, tc.input)
		if got.Kind != AvoidKindAllergen || got.CanonicalItem != tc.want {
			t.Errorf("ResolveAvoid(%q) = %q (%s), want %q (allergen)",
				tc.input, got.CanonicalItem, got.Kind, tc.want)
		}
	}
}

// A specific member resolves to itself — the family does not swallow it — but
// says which family it belongs to, so the client can offer the broader entry.
func TestResolveAvoid_MemberItemReportsItsFamilies(t *testing.T) {
	got := resolveAvoid(t, "peanut butter")
	if got.Kind != AvoidKindItem || got.CanonicalItem != "peanut butter" {
		t.Fatalf("peanut butter -> %+v, want the item itself", got)
	}
	if !slices.Contains(got.Families, "peanut") {
		t.Errorf("families = %v, want peanut", got.Families)
	}
}

// Overlapping families are real: egg noodles are egg AND wheat, and an item
// carrying only one of them would leave the other allergy unprotected.
func TestItemDetails_CarryEveryAllergenFamilyTheItemBelongsTo(t *testing.T) {
	d := normalizer.Details("egg noodles")
	if !slices.Contains(d.Allergens, "egg") || !slices.Contains(d.Allergens, "wheat") {
		t.Fatalf("egg noodles allergens = %v, want both egg and wheat", d.Allergens)
	}
	if a := normalizer.Details("rice").Allergens; len(a) != 0 {
		t.Errorf("rice allergens = %v, want none", a)
	}
	if a := normalizer.Details("unobtainium").Allergens; len(a) != 0 {
		t.Errorf("unknown item allergens = %v, want none — we do not know what it is", a)
	}
}

// Every family member must be a real canonical item. A member that matches no
// item filters nothing, which is precisely the silent failure being fixed, so it
// has to be a load-time error rather than a quiet no-op.
func TestLoadNormalizer_RejectsAllergenMemberThatIsNotAnItem(t *testing.T) {
	_, err := loadNormalizer([]byte(`{
		"items": {"rice": {"display": "Rice", "aisle": "pantry"}},
		"allergens": {"peanut": {"display": "Peanuts", "names": ["peanut"], "items": ["peanut butter"]}}
	}`))
	if err == nil {
		t.Fatal("loaded an allergen family listing an unknown item; it would filter nothing")
	}
}

func TestLoadNormalizer_RejectsAllergenNameClaimedByTwoFamilies(t *testing.T) {
	_, err := loadNormalizer([]byte(`{
		"items": {"rice": {"display": "Rice", "aisle": "pantry"}},
		"allergens": {
			"a": {"display": "A", "names": ["nut"], "items": ["rice"]},
			"b": {"display": "B", "names": ["nut"], "items": ["rice"]}
		}
	}`))
	if err == nil {
		t.Fatal("loaded two families claiming one name; one of them would never match")
	}
}

// The end-to-end property, across canonicalization AND ranking: the avoid entry
// and the recipe's ingredient text are different strings that mean the same
// thing. Every earlier test in the repo used "peanut" for both, so only the
// identity case was covered.
func TestAvoidListRemovesRecipesWhoseTextDiffersFromTheEntry(t *testing.T) {
	recipes := []Recipe{
		{ID: "r1", Title: "Scallion pancakes", Ingredients: []Ingredient{
			{Quantity: 4, Unit: "", Item: "chopped Scallions"},
			{Quantity: 1, Unit: "cup", Item: "flour"},
		}},
		{ID: "r2", Title: "Satay noodles", Ingredients: []Ingredient{
			{Quantity: 2, Unit: "tbsp", Item: "creamy peanut butter"},
			{Quantity: 200, Unit: "g", Item: "rice noodles"},
		}},
		{ID: "r3", Title: "Steamed rice", Ingredients: []Ingredient{
			{Quantity: 1, Unit: "cup", Item: "rice"},
		}},
	}
	candidates := toCandidates(recipes, "user")

	for _, tc := range []struct {
		name, entry string
		gone        string
	}{
		// "scallion" is stored canonicalized as "green onion" (see ResolveAvoid),
		// and the recipe line reads "Scallions, chopped".
		{"synonym entry vs plural modified text", "scallion", "r1"},
		// The family entry reaches an ingredient that is not the entry at all.
		{"allergen family vs a member ingredient", "peanut", "r2"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			res := resolveAvoid(t, tc.entry)
			uc := recommend.UserContext{
				IncludeUnmatched: true,
				Preferences:      recommend.Preferences{AvoidItems: []string{res.CanonicalItem}},
			}
			for _, got := range recommend.RankPantry(uc, candidates) {
				if got.RecipeID == tc.gone {
					t.Fatalf("avoiding %q (stored as %q) left %q in the results",
						tc.entry, res.CanonicalItem, got.Title)
				}
			}
		})
	}
}

func TestNormalizationAvoidEndpoint_ResolvesEachEntryInOrder(t *testing.T) {
	srv, _ := newTestServer(t)
	resp := postJSON(t, srv.URL+"/normalization/avoid",
		`{"entries":["Scallion","peanut","unobtainium","  "]}`)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	var got struct {
		Entries []AvoidResolution `json:"entries"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	if len(got.Entries) != 3 {
		t.Fatalf("got %d entries, want 3 (the blank one dropped): %+v", len(got.Entries), got.Entries)
	}
	if got.Entries[0].Input != "Scallion" || got.Entries[0].CanonicalItem != "green onion" {
		t.Errorf("entry 0 = %+v, want scallion -> green onion", got.Entries[0])
	}
	if got.Entries[1].Kind != AvoidKindAllergen || len(got.Entries[1].Members) == 0 {
		t.Errorf("entry 1 = %+v, want the peanut family with its members", got.Entries[1])
	}
	if got.Entries[2].Kind != AvoidKindUnknown {
		t.Errorf("entry 2 = %+v, want unknown", got.Entries[2])
	}
}

// Duplicates are NOT collapsed, unlike /normalization/lookup. Two entries that
// resolve to the same thing are two things the user typed, and the client has to
// be able to tell them apart to report on either.
func TestNormalizationAvoidEndpoint_AnswersOneToOne(t *testing.T) {
	srv, _ := newTestServer(t)
	resp := postJSON(t, srv.URL+"/normalization/avoid", `{"entries":["scallion","green onions"]}`)
	defer resp.Body.Close()
	var got struct {
		Entries []AvoidResolution `json:"entries"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	if len(got.Entries) != 2 {
		t.Fatalf("got %d entries, want one per input: %+v", len(got.Entries), got.Entries)
	}
}

func TestNormalizationAvoidEndpoint_RequiresAuth(t *testing.T) {
	srv, _ := newTestServer(t)
	resp, err := http.Post(srv.URL+"/normalization/avoid", "application/json", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", resp.StatusCode)
	}
}
