package recipe

import (
	"strings"
	"testing"
)

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

// --- purchase units and residue (BL-0032) ---

func TestPurchasePacksAreWellFormed(t *testing.T) {
	// The dataset guard, restated as a test so a bad pack fails CI rather than
	// only the process that happens to boot the normalizer next.
	for key, it := range normalizer.data.Items {
		p := it.Purchase
		if p == nil {
			continue
		}
		if strings.TrimSpace(p.Unit) == "" {
			t.Errorf("%q: purchase.unit is empty", key)
		}
		if p.Size <= 0 {
			t.Errorf("%q: purchase.size = %v, want > 0", key, p.Size)
		}
		if _, _, ok := normalizer.Unit(p.SizeUnit); !ok {
			t.Errorf("%q: purchase.sizeUnit %q is not convertible", key, p.SizeUnit)
		}
	}
}

func TestLoadNormalizerRejectsUnknownPackUnit(t *testing.T) {
	// A typo'd sizeUnit is otherwise invisible: the item would simply never get
	// a purchase unit, which looks exactly like "we have no pack data for it".
	raw := `{"units":{"cup":{"dimension":"volume","toBase":236.588}},
	         "items":{"parsley":{"display":"Parsley","aisle":"produce",
	           "purchase":{"unit":"bunch","size":0.5,"sizeUnit":"cupp"}}}}`
	if _, err := loadNormalizer([]byte(raw)); err == nil {
		t.Fatal("loadNormalizer accepted a pack whose sizeUnit is not a unit")
	}
}

func TestPurchaseFor_RoundsUpToWholePacksAndReportsResidue(t *testing.T) {
	// The item's own example: 2 tbsp of parsley still costs you a whole bunch,
	// and most of that bunch outlives the recipe that bought it.
	_, toBase, _ := normalizer.Unit("tbsp")
	got := normalizer.purchaseFor("parsley", "volume", 2*toBase, 2, "tbsp")
	if got == nil {
		t.Fatal("no purchase for parsley")
	}
	if got.Quantity != 1 || got.Unit != "bunch" {
		t.Fatalf("buy %v %s, want 1 bunch", got.Quantity, got.Unit)
	}
	// Half a cup is 8 tbsp; 2 are used.
	if got.Residue != 6 || got.ResidueUnit != "tbsp" {
		t.Fatalf("residue = %v %s, want 6 tbsp", got.Residue, got.ResidueUnit)
	}
}

func TestPurchaseFor_NeedOverAPackBuysTwo(t *testing.T) {
	_, toBase, _ := normalizer.Unit("cup")
	got := normalizer.purchaseFor("parsley", "volume", 0.75*toBase, 0.75, "cup")
	if got == nil || got.Quantity != 2 {
		t.Fatalf("got %+v, want 2 bunches for a three-quarter-cup need", got)
	}
	if got.Residue != 4 || got.ResidueUnit != "tbsp" {
		t.Fatalf("residue = %v %s, want 4 tbsp", got.Residue, got.ResidueUnit)
	}
}

func TestPurchaseFor_ExactPackLeavesNoResidue(t *testing.T) {
	// One quart of buttermilk is one carton and nothing left over. A phantom
	// residue here would put "0 ml buttermilk" into the leftovers prompt.
	got := normalizer.purchaseFor("buttermilk", "volume", 946, 946, "ml")
	if got == nil || got.Quantity != 1 || got.Unit != "quart" {
		t.Fatalf("got %+v, want 1 quart", got)
	}
	if got.Residue != 0 || got.ResidueUnit != "" {
		t.Fatalf("residue = %v %s, want none", got.Residue, got.ResidueUnit)
	}
}

func TestPurchaseFor_CountingInThePacksOwnUnit(t *testing.T) {
	// "2 bunches parsley" is already a purchase quantity; buying is just
	// rounding up to whole packs.
	got := normalizer.purchaseFor("parsley", "", 0, 1.5, "bunch")
	if got == nil || got.Quantity != 2 || got.Unit != "bunch" {
		t.Fatalf("got %+v, want 2 bunches", got)
	}
	if got.Residue != 0.5 || got.ResidueUnit != "bunch" {
		t.Fatalf("residue = %v %s, want 0.5 bunch", got.Residue, got.ResidueUnit)
	}
}

func TestPurchaseFor_UnanswerableNeedsStaySilent(t *testing.T) {
	cases := []struct {
		name      string
		canonical string
		dim       string
		baseQty   float64
		needQty   float64
		needUnit  string
	}{
		// No pack data at all: the line stays exactly as it was.
		{"no pack", "tomato", "volume", 500, 2, "cup"},
		// Mass need against a volume pack: bridging it needs a density nothing
		// in this dataset supplies.
		{"wrong dimension", "parsley", "mass", 30, 30, "g"},
		// A non-convertible unit that isn't the pack's own.
		{"foreign count unit", "parsley", "", 0, 3, "sprig"},
		// Unknown items have no record to carry a pack.
		{"unknown item", "unobtainium", "volume", 500, 2, "cup"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := normalizer.purchaseFor(tc.canonical, tc.dim, tc.baseQty, tc.needQty, tc.needUnit); got != nil {
				t.Fatalf("got %+v, want nil", got)
			}
		})
	}
}

func TestDetailsExposesThePack(t *testing.T) {
	d := normalizer.Details("Flat-leaf parsley")
	if d.Pack == nil || d.Pack.Unit != "bunch" {
		t.Fatalf("pack = %+v, want a bunch — a synonym must resolve to it too", d.Pack)
	}
	if normalizer.Details("tomato").Pack != nil {
		t.Error("an item with no pack data must report none rather than a zero pack")
	}
}
