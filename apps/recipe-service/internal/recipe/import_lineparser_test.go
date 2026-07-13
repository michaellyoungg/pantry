package recipe

import "testing"

func TestParseIngredientLine(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want Ingredient
	}{
		{"qty unit item note", "2 cloves garlic, minced", Ingredient{Quantity: 2, Unit: "clove", Item: "garlic", Note: "minced"}},
		{"mixed number", "1 1/2 cups flour", Ingredient{Quantity: 1.5, Unit: "cup", Item: "flour"}},
		{"unicode fraction", "½ teaspoon salt", Ingredient{Quantity: 0.5, Unit: "tsp", Item: "salt"}},
		{"glued unicode fraction", "1½ cups sugar", Ingredient{Quantity: 1.5, Unit: "cup", Item: "sugar"}},
		{"range takes low", "1-2 tablespoons olive oil", Ingredient{Quantity: 1, Unit: "tbsp", Item: "olive oil"}},
		{"no unit", "3 large eggs", Ingredient{Quantity: 3, Unit: "", Item: "large eggs"}},
		{"no quantity", "Salt to taste", Ingredient{Quantity: 0, Unit: "", Item: "Salt to taste"}},
		{"decimal", "0.5 cup milk", Ingredient{Quantity: 0.5, Unit: "cup", Item: "milk"}},
		{"simple fraction", "3/4 cup butter", Ingredient{Quantity: 0.75, Unit: "cup", Item: "butter"}},

		// Hardening: units that were previously missed.
		{"parenthetical hides unit", "1 (15-ounce) can diced tomatoes", Ingredient{Quantity: 1, Unit: "can", Item: "diced tomatoes"}},
		{"trailing parenthetical", "2 cups flour (sifted)", Ingredient{Quantity: 2, Unit: "cup", Item: "flour"}},
		{"glued metric gram", "500g flour", Ingredient{Quantity: 500, Unit: "g", Item: "flour"}},
		{"glued abbreviation", "2tbsp olive oil", Ingredient{Quantity: 2, Unit: "tbsp", Item: "olive oil"}},
		{"expanded unit quart", "1 quart chicken stock", Ingredient{Quantity: 1, Unit: "qt", Item: "chicken stock"}},
		{"expanded unit sprig", "2 sprigs thyme", Ingredient{Quantity: 2, Unit: "sprig", Item: "thyme"}},
		{"expanded unit stick", "1 stick butter", Ingredient{Quantity: 1, Unit: "stick", Item: "butter"}},
		{"expanded unit can plural", "2 cans black beans", Ingredient{Quantity: 2, Unit: "can", Item: "black beans"}},
		{"multi-word fluid ounce", "8 fluid ounces heavy cream", Ingredient{Quantity: 8, Unit: "fl oz", Item: "heavy cream"}},
		{"of filler dropped", "3 cloves of garlic", Ingredient{Quantity: 3, Unit: "clove", Item: "garlic"}},
		{"en-dash range takes low", "1–2 teaspoons cumin", Ingredient{Quantity: 1, Unit: "tsp", Item: "cumin"}},
		{"unit with trailing period", "2 tbsp. sugar", Ingredient{Quantity: 2, Unit: "tbsp", Item: "sugar"}},

		// Regression guards: non-units must stay in the item text.
		{"glued non-unit untouched", "9x13 pan of lasagna", Ingredient{Quantity: 0, Unit: "", Item: "9x13 pan of lasagna"}},
		{"count without unit", "2 onions", Ingredient{Quantity: 2, Unit: "", Item: "onions"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := parseIngredientLine(tc.in)
			if got != tc.want {
				t.Fatalf("parseIngredientLine(%q) = %+v, want %+v", tc.in, got, tc.want)
			}
		})
	}
}
