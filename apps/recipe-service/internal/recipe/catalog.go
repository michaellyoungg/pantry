package recipe

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"strings"
)

//go:embed catalog.json
var catalogJSON []byte

// catalogEntry is the on-disk shape of a curated recipe. user_id is intentionally
// absent from the file — LoadCatalog forces every entry to CatalogUserID.
type catalogEntry struct {
	ID          string       `json:"id"`
	Title       string       `json:"title"`
	Ingredients []Ingredient `json:"ingredients"`
}

// LoadCatalog parses the embedded catalog dataset into system-owned recipes,
// validating each entry. It does not touch any store.
func LoadCatalog() ([]Recipe, error) {
	var entries []catalogEntry
	if err := json.Unmarshal(catalogJSON, &entries); err != nil {
		return nil, fmt.Errorf("parse catalog.json: %w", err)
	}
	seen := map[string]bool{}
	out := make([]Recipe, 0, len(entries))
	for i, e := range entries {
		if strings.TrimSpace(e.ID) == "" {
			return nil, fmt.Errorf("catalog entry %d: id is required", i)
		}
		if strings.TrimSpace(e.Title) == "" {
			return nil, fmt.Errorf("catalog entry %q: title is required", e.ID)
		}
		if len(e.Ingredients) == 0 {
			return nil, fmt.Errorf("catalog entry %q: at least one ingredient is required", e.ID)
		}
		if seen[e.ID] {
			return nil, fmt.Errorf("catalog entry %q: duplicate id", e.ID)
		}
		seen[e.ID] = true
		out = append(out, Recipe{
			ID:          e.ID,
			UserID:      CatalogUserID,
			Title:       e.Title,
			Ingredients: e.Ingredients,
		})
	}
	return out, nil
}
