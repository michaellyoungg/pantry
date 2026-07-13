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
