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
	Steps       []string     `json:"steps"`
	// Equipment and Methods are curated per entry (BL-0041) rather than
	// detected: catalog recipes are hand-written, so the tags can be right.
	Equipment []RecipeEquipment `json:"equipment"`
	Methods   []string          `json:"methods"`
	// Discovery metadata (BL-0020), curated for the same reason. These are what
	// the catalog's filter chips are built from, so the seed set is the one
	// place they are guaranteed to be present and accurate.
	Cuisine      string   `json:"cuisine"`
	TotalMinutes *int     `json:"totalMinutes"`
	Tags         []string `json:"tags"`
	// SourceURL attributes an entry that came from somewhere (BL-0030). Most
	// curated entries are hand-written and leave it out; it is never invented,
	// because a fabricated attribution is worse than none.
	SourceURL string `json:"sourceUrl"`
}

// LoadCatalog parses the embedded catalog dataset into system-owned recipes,
// validating each entry. It does not touch any store.
func LoadCatalog() ([]Recipe, error) {
	return parseCatalog(catalogJSON)
}

// parseCatalog is LoadCatalog against arbitrary bytes, so the validation rules
// can be tested against fixtures instead of only against whatever the shipped
// seed file happens to contain today.
func parseCatalog(data []byte) ([]Recipe, error) {
	var entries []catalogEntry
	if err := json.Unmarshal(data, &entries); err != nil {
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
		if err := ValidateTags(e.Equipment, e.Methods); err != nil {
			return nil, fmt.Errorf("catalog entry %q: %w", e.ID, err)
		}
		// Catalog entries go through the same validator as a client request, so
		// a typo in the seed file fails the boot rather than shipping a chip
		// nobody can match.
		cuisine, tags, sourceURL, err := ValidateDiscovery(e.Cuisine, e.TotalMinutes, e.Tags, e.SourceURL)
		if err != nil {
			return nil, fmt.Errorf("catalog entry %q: %w", e.ID, err)
		}
		seen[e.ID] = true
		out = append(out, Recipe{
			ID:           e.ID,
			UserID:       CatalogUserID,
			Title:        e.Title,
			Ingredients:  e.Ingredients,
			Steps:        e.Steps,
			Equipment:    normEquipment(e.Equipment),
			Methods:      normMethods(e.Methods),
			Cuisine:      cuisine,
			TotalMinutes: e.TotalMinutes,
			Tags:         tags,
			SourceURL:    sourceURL,
		})
	}
	return out, nil
}
