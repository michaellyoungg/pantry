package recipe

import (
	"strings"
	"testing"
)

func TestSlugifyFoldsSpellingsTogether(t *testing.T) {
	// The whole point of slugify: these are one chip, not five.
	for _, in := range []string{"Gluten Free", "gluten_free", "GLUTEN-FREE", "  gluten   free  ", "gluten/free"} {
		if got := slugify(in); got != "gluten-free" {
			t.Errorf("slugify(%q) = %q, want %q", in, got, "gluten-free")
		}
	}
}

func TestSlugifyDropsUnusableInput(t *testing.T) {
	for _, in := range []string{"", "   ", "!!!", "-", "___"} {
		if got := slugify(in); got != "" {
			t.Errorf("slugify(%q) = %q, want empty", in, got)
		}
	}
}

func TestSlugifyTrimsSeparatorsAtBothEnds(t *testing.T) {
	if got := slugify("--Thai--"); got != "thai" {
		t.Errorf("slugify(--Thai--) = %q, want thai", got)
	}
}

func TestNormTagsDedupesAfterNormalizationKeepingOrder(t *testing.T) {
	got := normTags([]string{"Vegan", "weeknight", "VEGAN", "", "  ", "one_pot", "one pot"})
	want := []string{"vegan", "weeknight", "one-pot"}
	if len(got) != len(want) {
		t.Fatalf("normTags = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("normTags = %v, want %v", got, want)
		}
	}
}

func TestNormTagsReturnsEmptySliceNotNil(t *testing.T) {
	// Nil would marshal as `null` and break the [] wire contract.
	if got := normTags(nil); got == nil {
		t.Fatal("normTags(nil) returned nil; want an empty slice")
	}
}

func TestValidateDiscoveryNormalizesCuisineAndTags(t *testing.T) {
	cuisine, tags, source, err := ValidateDiscovery("  Italian ", intPtr(30), []string{"Weeknight"}, "")
	if err != nil {
		t.Fatalf("ValidateDiscovery: %v", err)
	}
	if cuisine != "italian" {
		t.Errorf("cuisine = %q, want italian", cuisine)
	}
	if len(tags) != 1 || tags[0] != "weeknight" {
		t.Errorf("tags = %v, want [weeknight]", tags)
	}
	if source != "" {
		t.Errorf("source = %q, want empty", source)
	}
}

func TestValidateDiscoveryAcceptsUnknownTotalMinutes(t *testing.T) {
	// nil is "unknown", not zero — the same discipline as servings (BL-0035).
	if _, _, _, err := ValidateDiscovery("", nil, nil, ""); err != nil {
		t.Fatalf("nil totalMinutes should be valid: %v", err)
	}
}

func TestValidateDiscoveryRejectsNonPositiveTotalMinutes(t *testing.T) {
	for _, m := range []int{0, -5, maxTotalMinutes + 1} {
		if _, _, _, err := ValidateDiscovery("", intPtr(m), nil, ""); err == nil {
			t.Errorf("totalMinutes %d should be rejected", m)
		}
	}
}

func TestValidateDiscoveryRejectsTooManyTags(t *testing.T) {
	many := make([]string, 0, maxTags+1)
	for i := 0; i <= maxTags; i++ {
		many = append(many, string(rune('a'+i%26))+strings.Repeat("x", i+1))
	}
	if _, _, _, err := ValidateDiscovery("", nil, many, ""); err == nil {
		t.Error("more than maxTags tags should be rejected")
	}
}

func TestValidateDiscoveryRejectsOverlongCuisine(t *testing.T) {
	if _, _, _, err := ValidateDiscovery(strings.Repeat("a", maxTagLen+1), nil, nil, ""); err == nil {
		t.Error("an overlong cuisine should be rejected")
	}
}

func TestNormSourceURLAcceptsHTTPAndHTTPS(t *testing.T) {
	for _, in := range []string{"http://example.com/r/1", "https://example.com/r/1?x=2"} {
		got, err := normSourceURL(in)
		if err != nil {
			t.Fatalf("normSourceURL(%q): %v", in, err)
		}
		if got != in {
			t.Errorf("normSourceURL(%q) = %q; the url must be preserved verbatim for re-import", in, got)
		}
	}
}

func TestNormSourceURLRejectsDangerousOrRelativeSchemes(t *testing.T) {
	for _, in := range []string{"javascript:alert(1)", "file:///etc/passwd", "example.com/recipe", "/recipes/1"} {
		if _, err := normSourceURL(in); err == nil {
			t.Errorf("normSourceURL(%q) should be rejected", in)
		}
	}
}

func TestNormSourceURLTreatsBlankAsAbsent(t *testing.T) {
	got, err := normSourceURL("   ")
	if err != nil {
		t.Fatalf("blank sourceUrl should be valid: %v", err)
	}
	if got != "" {
		t.Errorf("got %q, want empty", got)
	}
}
