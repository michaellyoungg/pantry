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
	ID          string       `json:"id"`
	UserID      string       `json:"userId"`
	Title       string       `json:"title"`
	Ingredients []Ingredient `json:"ingredients"`
	CreatedAt   time.Time    `json:"createdAt"`
}

type GroceryLine struct {
	Item     string  `json:"item"`
	Unit     string  `json:"unit"`
	Quantity float64 `json:"quantity"`
}
