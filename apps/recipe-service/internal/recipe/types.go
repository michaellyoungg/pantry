package recipe

import "time"

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
