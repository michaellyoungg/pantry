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
