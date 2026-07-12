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
