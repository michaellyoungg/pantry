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
