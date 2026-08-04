package recipe

import (
	"strings"
	"testing"
)

func TestLoadCatalog_ParsesValidatesAndOwnsAsCatalog(t *testing.T) {
	recs, err := LoadCatalog()
	if err != nil {
		t.Fatalf("LoadCatalog: %v", err)
	}
	if len(recs) < 5 {
		t.Fatalf("catalog has %d recipes, want at least 5", len(recs))
	}
	seen := map[string]bool{}
	for _, r := range recs {
		if r.UserID != CatalogUserID {
			t.Fatalf("recipe %q userID = %q, want %q", r.ID, r.UserID, CatalogUserID)
		}
		if !strings.HasPrefix(r.ID, "cat-") {
			t.Fatalf("recipe id %q, want a cat- prefix", r.ID)
		}
		if strings.TrimSpace(r.Title) == "" {
			t.Fatalf("recipe %q has an empty title", r.ID)
		}
		if len(r.Ingredients) == 0 {
			t.Fatalf("recipe %q has no ingredients", r.ID)
		}
		if seen[r.ID] {
			t.Fatalf("duplicate catalog id %q", r.ID)
		}
		seen[r.ID] = true
	}
}

// The catalog is the one recipe set guaranteed to carry discovery metadata, so
// it is also the only place the filter chips are guaranteed to have something
// to offer. An entry without a cook time is invisible to the weeknight filter.
func TestLoadCatalog_EveryEntryCarriesACookTimeAndTags(t *testing.T) {
	recs, err := LoadCatalog()
	if err != nil {
		t.Fatalf("LoadCatalog: %v", err)
	}
	for _, r := range recs {
		if r.TotalMinutes == nil {
			t.Errorf("catalog recipe %q has no totalMinutes; it cannot match the cook-time filter", r.ID)
		}
		if len(r.Tags) == 0 {
			t.Errorf("catalog recipe %q has no tags", r.ID)
		}
	}
}

func TestLoadCatalog_NormalizesDiscoveryMetadata(t *testing.T) {
	recs, err := LoadCatalog()
	if err != nil {
		t.Fatalf("LoadCatalog: %v", err)
	}
	for _, r := range recs {
		if r.Cuisine != slugify(r.Cuisine) {
			t.Errorf("catalog recipe %q cuisine %q is not normalized", r.ID, r.Cuisine)
		}
		for _, tag := range r.Tags {
			if tag != slugify(tag) {
				t.Errorf("catalog recipe %q tag %q is not normalized", r.ID, tag)
			}
		}
	}
}

// At least one catalog entry must leave its cuisine unset, so the "unknown
// cuisine" path in the filter UI is exercised by real seed data rather than
// only by a unit test's fixture.
func TestLoadCatalog_CoversBothKnownAndUnknownCuisine(t *testing.T) {
	recs, err := LoadCatalog()
	if err != nil {
		t.Fatalf("LoadCatalog: %v", err)
	}
	var known, unknown int
	for _, r := range recs {
		if r.Cuisine == "" {
			unknown++
		} else {
			known++
		}
	}
	if known == 0 || unknown == 0 {
		t.Fatalf("catalog has %d known and %d unknown cuisines; want at least one of each", known, unknown)
	}
}
