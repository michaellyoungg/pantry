package recipe

import "time"

// CatalogUserID owns the shared, system-curated recipe catalog (BL-0002).
// Catalog recipes are ordinary recipes rows with this user_id.
const CatalogUserID = "catalog"

type Ingredient struct {
	Quantity float64 `json:"quantity"`
	Unit     string  `json:"unit"`
	Item     string  `json:"item"`
	Note     string  `json:"note,omitempty"`
}

type Recipe struct {
	ID     string `json:"id"`
	UserID string `json:"userId"`
	Title  string `json:"title"`
	// Servings is how many people the recipe feeds, or nil when unknown —
	// existing recipes and manual entry without a yield both leave it unset.
	// It is an absolute count, unlike the planner's servingsMultiplier, which
	// is a scale factor on a basket entry. Consumers must omit per-serving
	// figures when it is nil rather than assume a default (BL-0035).
	Servings    *int         `json:"servings,omitempty"`
	Ingredients []Ingredient `json:"ingredients"`
	// Steps are the ordered instruction lines (the method). May be empty; recipes
	// imported before steps were persisted, or entered ingredients-only, have none.
	Steps []string `json:"steps"`
	// Equipment references the curated catalog by slug (BL-0041). May be empty:
	// recipes entered by hand and imports whose steps mention no known hardware
	// carry no tags.
	Equipment []RecipeEquipment `json:"equipment"`
	// Methods are members of the closed cooking-method enum. Closed because
	// BL-0042's prep rules key on them.
	Methods   []string  `json:"methods"`
	CreatedAt time.Time `json:"createdAt"`
}

// RecipeMatch is a recipe that uses at least one of a requested set of
// canonical items, plus which ones it hit. It backs the pantry's "use these up
// → cook this" nudge (BL-0029). The embedded Recipe's fields are inlined on the
// wire, so a match decodes as an ordinary recipe plus `matchedItems`.
type RecipeMatch struct {
	Recipe
	MatchedItems []string `json:"matchedItems"`
}

type GroceryLine struct {
	Item string `json:"item"`
	// CanonicalItem is the normalized ingredient key (lowercased, synonyms
	// resolved) that Item's display string was derived from. It is the identity
	// the pantry is keyed on — Item is for humans, CanonicalItem is for joins.
	CanonicalItem string  `json:"canonicalItem"`
	Unit          string  `json:"unit"`
	Quantity      float64 `json:"quantity"`
	Aisle         string  `json:"aisle"`
}
