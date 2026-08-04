package recipe

import (
	"reflect"
	"testing"
)

func r(title string, ings ...Ingredient) Recipe {
	return Recipe{Title: title, Ingredients: ings}
}

func TestAggregate_CombinesSameItemAndUnit(t *testing.T) {
	got := Aggregate([]Recipe{
		r("a", Ingredient{Quantity: 2, Unit: "cloves", Item: "garlic"}),
		r("b", Ingredient{Quantity: 1, Unit: "cloves", Item: "garlic"}),
	})
	want := []GroceryLine{{Item: "Garlic", CanonicalItem: "garlic", Unit: "cloves", Quantity: 3, Aisle: "produce"}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}

func TestAggregate_KeepsDifferentUnitsSeparate(t *testing.T) {
	got := Aggregate([]Recipe{
		r("a", Ingredient{Quantity: 2, Unit: "cloves", Item: "garlic"}),
		r("b", Ingredient{Quantity: 10, Unit: "grams", Item: "garlic"}),
	})
	want := []GroceryLine{
		{Item: "Garlic", CanonicalItem: "garlic", Unit: "cloves", Quantity: 2, Aisle: "produce"},
		{Item: "Garlic", CanonicalItem: "garlic", Unit: "grams", Quantity: 10, Aisle: "produce"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}

func TestAggregate_CombinesConvertibleUnits(t *testing.T) {
	// 4 tbsp + 0.5 cup butter = 12 tbsp -> 3/4 cup.
	got := Aggregate([]Recipe{
		r("a", Ingredient{Quantity: 4, Unit: "tbsp", Item: "butter"}),
		r("b", Ingredient{Quantity: 0.5, Unit: "cup", Item: "butter"}),
	})
	want := []GroceryLine{{Item: "Butter", CanonicalItem: "butter", Unit: "cup", Quantity: 0.75, Aisle: "dairy"}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}

func TestAggregate_MergesSynonyms(t *testing.T) {
	got := Aggregate([]Recipe{
		r("a", Ingredient{Quantity: 2, Unit: "cloves", Item: "garlic cloves"}),
		r("b", Ingredient{Quantity: 1, Unit: "cloves", Item: "fresh garlic"}),
	})
	want := []GroceryLine{{Item: "Garlic", CanonicalItem: "garlic", Unit: "cloves", Quantity: 3, Aisle: "produce"}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}

func TestAggregate_MixedDimensionsForOneItemStaySeparate(t *testing.T) {
	// A count and a volume of the same canonical item can't merge.
	got := Aggregate([]Recipe{
		r("a", Ingredient{Quantity: 2, Unit: "clove", Item: "garlic"}),
		r("b", Ingredient{Quantity: 1, Unit: "tbsp", Item: "garlic"}),
	})
	want := []GroceryLine{
		{Item: "Garlic", CanonicalItem: "garlic", Unit: "clove", Quantity: 2, Aisle: "produce"},
		{Item: "Garlic", CanonicalItem: "garlic", Unit: "tbsp", Quantity: 1, Aisle: "produce"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}

func TestAggregate_SortsByAisleThenFirstSeen(t *testing.T) {
	// unobtainium (unknown -> other) seen first, milk (dairy) second; dairy sorts before other.
	got := Aggregate([]Recipe{
		r("a",
			Ingredient{Quantity: 1, Unit: "", Item: "unobtainium"},
			Ingredient{Quantity: 1, Unit: "cup", Item: "milk"},
		),
		r("b", Ingredient{Quantity: 2, Unit: "", Item: "unobtainium"}),
	})
	want := []GroceryLine{
		{Item: "Milk", CanonicalItem: "milk", Unit: "cup", Quantity: 1, Aisle: "dairy"},
		{Item: "unobtainium", CanonicalItem: "unobtainium", Unit: "", Quantity: 3, Aisle: "other"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}

func TestAggregate_EmptyInputYieldsEmptySlice(t *testing.T) {
	got := Aggregate(nil)
	if got == nil {
		t.Fatal("got nil, want non-nil empty slice")
	}
	if len(got) != 0 {
		t.Fatalf("got %+v, want empty", got)
	}
}

func TestAggregateScaled_MultipliesQuantities(t *testing.T) {
	got := AggregateScaled([]ScaledRecipe{
		{Recipe: r("a", Ingredient{Quantity: 2, Unit: "cloves", Item: "garlic"}), Multiplier: 2},
	})
	want := []GroceryLine{{Item: "Garlic", CanonicalItem: "garlic", Unit: "cloves", Quantity: 4, Aisle: "produce"}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}

func TestAggregateScaled_SumsRepeatedRecipeInstances(t *testing.T) {
	rec := r("a", Ingredient{Quantity: 1, Unit: "cloves", Item: "garlic"})
	got := AggregateScaled([]ScaledRecipe{
		{Recipe: rec, Multiplier: 1},
		{Recipe: rec, Multiplier: 2},
	})
	want := []GroceryLine{{Item: "Garlic", CanonicalItem: "garlic", Unit: "cloves", Quantity: 3, Aisle: "produce"}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}

func TestAggregate_WrapperEqualsMultiplierOne(t *testing.T) {
	ings := r("a", Ingredient{Quantity: 3, Unit: "cloves", Item: "garlic"})
	if !reflect.DeepEqual(Aggregate([]Recipe{ings}),
		AggregateScaled([]ScaledRecipe{{Recipe: ings, Multiplier: 1}})) {
		t.Fatal("Aggregate must equal AggregateScaled at multiplier 1")
	}
}

func TestAggregate_EmitsCanonicalItem(t *testing.T) {
	got := Aggregate([]Recipe{
		// "scallions" is a real synonym in normalization.json resolving to the
		// canonical "green onion". (Note: there is no pluralization logic —
		// "green onions" would NOT resolve. Only listed synonyms do.)
		r("a", Ingredient{Quantity: 2, Unit: "bunch", Item: "scallions"}),
	})
	if len(got) != 1 {
		t.Fatalf("got %d lines, want 1", len(got))
	}
	if got[0].CanonicalItem != "green onion" {
		t.Fatalf("CanonicalItem = %q, want %q", got[0].CanonicalItem, "green onion")
	}
	if got[0].Item != "Green onion" {
		t.Fatalf("Item = %q, want display %q", got[0].Item, "Green onion")
	}
}

func TestAggregate_UnknownItemCanonicalPassesThrough(t *testing.T) {
	got := Aggregate([]Recipe{
		r("a", Ingredient{Quantity: 1, Unit: "", Item: "Dragonfruit"}),
	})
	if len(got) != 1 {
		t.Fatalf("got %d lines, want 1", len(got))
	}
	if got[0].CanonicalItem != "dragonfruit" {
		t.Fatalf("CanonicalItem = %q, want %q", got[0].CanonicalItem, "dragonfruit")
	}
}

// rid is r with an id — provenance is only recorded for recipes that have one,
// because a source the client can't navigate to isn't worth carrying.
func rid(id, title string, ings ...Ingredient) Recipe {
	return Recipe{ID: id, Title: title, Ingredients: ings}
}

func TestAggregate_RecordsContributingRecipes(t *testing.T) {
	got := Aggregate([]Recipe{
		rid("r1", "Chili", Ingredient{Quantity: 2, Unit: "cloves", Item: "garlic"}),
		rid("r2", "Aioli", Ingredient{Quantity: 1, Unit: "cloves", Item: "garlic"}),
	})
	want := []GroceryLine{{
		Item: "Garlic", CanonicalItem: "garlic", Unit: "cloves", Quantity: 3, Aisle: "produce",
		Sources: []GroceryLineSource{
			{RecipeID: "r1", Title: "Chili", Quantity: 2},
			{RecipeID: "r2", Title: "Aioli", Quantity: 1},
		},
	}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}

func TestAggregate_SourceQuantitiesAreInTheLineUnit(t *testing.T) {
	// 4 tbsp + 0.5 cup -> a 3/4 cup line; the sources must read 1/4 + 1/2 cup so
	// they visibly add up to the total the shopper is looking at.
	got := Aggregate([]Recipe{
		rid("r1", "Cookies", Ingredient{Quantity: 4, Unit: "tbsp", Item: "butter"}),
		rid("r2", "Toast", Ingredient{Quantity: 0.5, Unit: "cup", Item: "butter"}),
	})
	want := []GroceryLineSource{
		{RecipeID: "r1", Title: "Cookies", Quantity: 0.25},
		{RecipeID: "r2", Title: "Toast", Quantity: 0.5},
	}
	if !reflect.DeepEqual(got[0].Sources, want) {
		t.Fatalf("sources = %+v, want %+v", got[0].Sources, want)
	}
}

func TestAggregateScaled_SourceQuantitiesAreScaled(t *testing.T) {
	got := AggregateScaled([]ScaledRecipe{
		{Recipe: rid("r1", "Chili", Ingredient{Quantity: 2, Unit: "cloves", Item: "garlic"}), Multiplier: 1.5},
	})
	if got[0].Sources[0].Quantity != 3 {
		t.Fatalf("source quantity = %v, want 3 (2 x 1.5)", got[0].Sources[0].Quantity)
	}
}

func TestAggregate_OneRecipeUsedTwiceIsOneSource(t *testing.T) {
	// The same recipe twice in a week's plan is one recipe on the sheet, with
	// its contributions summed — not the same title listed twice.
	got := AggregateScaled([]ScaledRecipe{
		{Recipe: rid("r1", "Chili", Ingredient{Quantity: 2, Unit: "cloves", Item: "garlic"}), Multiplier: 1},
		{Recipe: rid("r1", "Chili", Ingredient{Quantity: 2, Unit: "cloves", Item: "garlic"}), Multiplier: 1},
	})
	want := []GroceryLineSource{{RecipeID: "r1", Title: "Chili", Quantity: 4}}
	if !reflect.DeepEqual(got[0].Sources, want) {
		t.Fatalf("sources = %+v, want %+v", got[0].Sources, want)
	}
}

func TestAggregate_SourcesFollowSeparateLinesOfTheSameItem(t *testing.T) {
	// Non-convertible units keep two lines for one item; each line carries only
	// the recipe that produced it, not both.
	got := Aggregate([]Recipe{
		rid("r1", "Chili", Ingredient{Quantity: 2, Unit: "cloves", Item: "garlic"}),
		rid("r2", "Paste", Ingredient{Quantity: 10, Unit: "grams", Item: "garlic"}),
	})
	if len(got) != 2 {
		t.Fatalf("got %d lines, want 2", len(got))
	}
	if len(got[0].Sources) != 1 || got[0].Sources[0].RecipeID != "r1" {
		t.Fatalf("cloves line sources = %+v, want just r1", got[0].Sources)
	}
	if len(got[1].Sources) != 1 || got[1].Sources[0].RecipeID != "r2" {
		t.Fatalf("grams line sources = %+v, want just r2", got[1].Sources)
	}
}

func TestAggregate_RecipeWithoutIDContributesNoSource(t *testing.T) {
	got := Aggregate([]Recipe{
		r("untitled", Ingredient{Quantity: 1, Unit: "", Item: "egg"}),
	})
	if got[0].Sources != nil {
		t.Fatalf("sources = %+v, want nil for an id-less recipe", got[0].Sources)
	}
}
