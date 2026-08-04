package recipe

import "testing"

func TestCanonicalItem_KnownSynonymResolvesToDisplayAndAisle(t *testing.T) {
	canon, display, aisle := normalizer.CanonicalItem(" Garlic Cloves ")
	if canon != "garlic" || display != "Garlic" || aisle != "produce" {
		t.Fatalf("got (%q,%q,%q), want (garlic,Garlic,produce)", canon, display, aisle)
	}
}

func TestCanonicalItem_UnknownPassesThroughWithFirstSeenCasing(t *testing.T) {
	// A deliberately absurd item: the dictionary grows (BL-0031), so a real
	// ingredient used as the "unknown" fixture eventually stops being one and
	// the test starts asserting nothing.
	canon, display, aisle := normalizer.CanonicalItem(" Unobtainium ")
	if canon != "unobtainium" || display != "Unobtainium" || aisle != "other" {
		t.Fatalf("got (%q,%q,%q), want (unobtainium,Unobtainium,other)", canon, display, aisle)
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

func TestSnapNice(t *testing.T) {
	cases := []struct {
		in, want float64
	}{
		{0.30000000000000004, 0.3}, // float noise, not a nice fraction -> 2dp
		{0.749, 0.75},              // within epsilon of 3/4
		{0.6667, 0.667},            // within epsilon of 2/3
		{2.0, 2.0},
		{2.4, 2.4}, // not within epsilon of any nice value -> 2dp
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

func TestShelfLife_PerItemOverridesAisleDefault(t *testing.T) {
	d := normalizer.Details("spinach")
	if d.Aisle != "produce" || d.ShelfLifeDays != 5 {
		t.Fatalf("spinach: got aisle=%q shelfLife=%d, want produce/5", d.Aisle, d.ShelfLifeDays)
	}
}

func TestShelfLife_FallsBackToAisleDefault(t *testing.T) {
	n, err := loadNormalizer([]byte(`{
		"items": {"widget": {"display": "Widget", "aisle": "produce"}},
		"aisleShelfLife": {"produce": 7}
	}`))
	if err != nil {
		t.Fatal(err)
	}
	if d := n.Details("widget"); d.ShelfLifeDays != 7 {
		t.Fatalf("got %d, want the produce default of 7", d.ShelfLifeDays)
	}
}

func TestShelfLife_UnknownItemHasNone(t *testing.T) {
	d := normalizer.Details("unobtainium")
	if d.Aisle != "other" || d.ShelfLifeDays != 0 {
		t.Fatalf("got aisle=%q shelfLife=%d, want other/0 (never guess for unknown items)", d.Aisle, d.ShelfLifeDays)
	}
}

func TestCanonicalItem_FoldsKnownPluralsToSingular(t *testing.T) {
	cases := []struct{ in, want string }{
		{"tomatoes", "tomato"},
		{"eggs", "egg"},
		{"strawberries", "strawberry"},
		{"Carrots", "carrot"},
	}
	for _, c := range cases {
		if got, _, _ := normalizer.CanonicalItem(c.in); got != c.want {
			t.Errorf("CanonicalItem(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestCanonicalItem_LeavesUnknownPluralLookingWordsAlone(t *testing.T) {
	// "asparagus" must not be butchered into "asparagu" by naive -s stripping.
	if got, _, aisle := normalizer.CanonicalItem("asparagus"); got != "asparagus" || aisle != "produce" {
		t.Errorf("asparagus: got %q/%q, want asparagus/produce", got, aisle)
	}
	if got, _, _ := normalizer.CanonicalItem("hummus"); got != "hummus" {
		t.Errorf("hummus: got %q, want hummus unchanged", got)
	}
}

// --- modifier stripping (BL-0031) ------------------------------------------

func TestCanonicalItem_StripsModifiersFromRealRecipeText(t *testing.T) {
	cases := []struct{ in, want string }{
		{"chopped fresh cilantro", "cilantro"},
		{"2 large eggs", "2 large eggs"}, // no quantity parsing here — item text only
		{"large yellow onion", "onion"},
		{"freshly grated Parmesan cheese", "parmesan"},
		{"boneless skinless chicken thighs", "chicken thigh"},
		{"low-sodium chicken broth", "chicken stock"},
		{"extra-virgin olive oil", "olive oil"},
		{"fine sea salt", "salt"},
		{"salt to taste", "salt"},
		{"baby spinach", "spinach"},
		{"ripe avocado", "avocado"},
		{"unsweetened cocoa powder", "cocoa powder"},
		{"packed light brown sugar", "brown sugar"},
		{"pitted kalamata olives", "olive"},
		{"basil leaves", "basil"},
		{"olive oil, for serving", "olive oil, for serving"}, // note splitting is the parser's job
	}
	for _, c := range cases {
		if got, _, _ := normalizer.CanonicalItem(c.in); got != c.want {
			t.Errorf("CanonicalItem(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestCanonicalItem_LiteralEntryBeatsModifierStripping(t *testing.T) {
	// Each of these CONTAINS a modifier word but names its own distinct item.
	// A literal hit must win, or the dictionary would fold real products into
	// their ingredients — the confident-wrong-join the design rejects.
	cases := []struct{ in, want string }{
		{"crushed tomatoes", "canned tomato"},
		{"ground beef", "ground beef"},
		{"ground turkey", "ground turkey"},
		{"frozen peas", "frozen pea"},
		{"dried basil", "dried basil"},
		{"cream cheese", "cream cheese"},
		{"sour cream", "sour cream"},
		{"english muffins", "english muffin"},
		{"whole chicken", "whole chicken"},
		{"sun-dried tomato", "sun-dried tomato"},
	}
	for _, c := range cases {
		if got, _, _ := normalizer.CanonicalItem(c.in); got != c.want {
			t.Errorf("CanonicalItem(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestCanonicalItem_NeverStripsWordsThatChangeTheItem(t *testing.T) {
	// The words below are NOT modifiers, and the failure they prevent is a
	// pantry that tells you to buy the wrong thing.
	cases := []struct{ in, want string }{
		{"chicken stock", "chicken stock"}, // not "chicken"
		{"smoked salmon", "smoked salmon"}, // not "salmon"
		{"red onion", "red onion"},         // not "onion"
		{"green bean", "green bean"},       // not "bean"
		{"sweet potato", "sweet potato"},   // not "potato"
		{"canned tuna", "canned tuna"},     // not "tuna"
		{"italian seasoning", "italian seasoning"},
	}
	for _, c := range cases {
		if got, _, _ := normalizer.CanonicalItem(c.in); got != c.want {
			t.Errorf("CanonicalItem(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestCanonicalItem_StripsTheLeastItCanGetAwayWith(t *testing.T) {
	// "cheese" is a modifier ("ricotta cheese" -> ricotta), but dropping every
	// modifier at once here would leave "blue" and lose the item entirely.
	if got, _, _ := normalizer.CanonicalItem("crumbled blue cheese"); got != "blue cheese" {
		t.Errorf("crumbled blue cheese = %q, want blue cheese", got)
	}
	if got, _, _ := normalizer.CanonicalItem("shredded sharp cheddar cheese"); got != "cheddar cheese" {
		t.Errorf("shredded sharp cheddar cheese = %q, want cheddar cheese", got)
	}
}

func TestCanonicalItem_TextMadeOnlyOfModifiersStaysUnknown(t *testing.T) {
	for _, in := range []string{"chopped fresh", "large", "to taste", "finely diced"} {
		d := normalizer.Details(in)
		if d.Known {
			t.Errorf("Details(%q) resolved to %q — modifier-only text names no ingredient", in, d.CanonicalItem)
		}
	}
}

// --- staple flag (BL-0031, unblocks BL-0005's missingNonStaple) -------------

func TestStapleFlag(t *testing.T) {
	staples := []string{"salt", "black pepper", "olive oil", "flour", "sugar", "cumin", "paprika"}
	for _, s := range staples {
		if d := normalizer.Details(s); !d.Staple {
			t.Errorf("%q should be a staple", s)
		}
	}
	// Things a cook actually has to go and buy.
	notStaples := []string{"chicken breast", "tomato", "milk", "butter", "salmon", "pasta", "rice"}
	for _, s := range notStaples {
		if d := normalizer.Details(s); d.Staple {
			t.Errorf("%q must not be a staple — a recipe SHOULD be penalized for missing it", s)
		}
	}
	// The conservative default: we never assume something we failed to recognize
	// is a staple, because that would quietly excuse it from the penalty.
	if d := normalizer.Details("unobtainium"); d.Staple || d.Known {
		t.Error("an unknown item must be neither known nor a staple")
	}
}

func TestStaplesAreAllShelfStable(t *testing.T) {
	// A staple is a thing on the shelf, not in the fridge. This is the invariant
	// that keeps the flag from drifting into "ingredients I think are common":
	// if a candidate staple is not sold in the pantry aisle, the flag is wrong.
	for key, it := range normalizer.data.Items {
		if it.Staple && it.Aisle != "pantry" {
			t.Errorf("%q is flagged staple but sits in the %q aisle", key, it.Aisle)
		}
	}
}
