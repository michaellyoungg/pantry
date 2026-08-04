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
	// Butter comes in half-cup sticks, so 3/4 cup is two of them with a quarter
	// cup left in the fridge.
	want := []GroceryLine{{
		Item: "Butter", CanonicalItem: "butter", Unit: "cup", Quantity: 0.75, Aisle: "dairy",
		Purchase: &GroceryPurchase{Quantity: 2, Unit: "stick", Residue: 4, ResidueUnit: "tbsp"},
	}}
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
		// Milk is sold by the quart, so the line also carries what to buy: one
		// quart, of which a cup is wanted and three cups survive the recipe.
		{
			Item: "Milk", CanonicalItem: "milk", Unit: "cup", Quantity: 1, Aisle: "dairy",
			Purchase: &GroceryPurchase{Quantity: 1, Unit: "quart", Residue: 3, ResidueUnit: "cup"},
		},
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

func TestAggregate_TwoRecipesShareOnePack(t *testing.T) {
	// Pack arithmetic runs on the SUMMED line, so two recipes each wanting
	// 2 tbsp of parsley buy one bunch between them, not one each.
	got := Aggregate([]Recipe{
		r("a", Ingredient{Quantity: 2, Unit: "tbsp", Item: "parsley"}),
		r("b", Ingredient{Quantity: 2, Unit: "tbsp", Item: "fresh parsley"}),
	})
	if len(got) != 1 {
		t.Fatalf("got %d lines, want 1", len(got))
	}
	p := got[0].Purchase
	if p == nil || p.Quantity != 1 || p.Unit != "bunch" {
		t.Fatalf("purchase = %+v, want 1 bunch", p)
	}
	// The line still states the NEED — provenance and pricing are built on it.
	if got[0].Quantity != 0.25 || got[0].Unit != "cup" {
		t.Fatalf("need = %v %s, want 0.25 cup", got[0].Quantity, got[0].Unit)
	}
	if p.Residue != 4 || p.ResidueUnit != "tbsp" {
		t.Fatalf("residue = %v %s, want 4 tbsp", p.Residue, p.ResidueUnit)
	}
}

func TestAggregate_ScalingUpABatchCanBuyASecondPack(t *testing.T) {
	// The residue is a function of the plan, not the recipe: doubling the batch
	// crosses the pack boundary and the list has to say so.
	single := Aggregate([]Recipe{r("a", Ingredient{Quantity: 0.4, Unit: "cup", Item: "parsley"})})
	double := AggregateScaled([]ScaledRecipe{
		{Recipe: r("a", Ingredient{Quantity: 0.4, Unit: "cup", Item: "parsley"}), Multiplier: 2},
	})
	if single[0].Purchase.Quantity != 1 {
		t.Fatalf("single batch buys %v bunches, want 1", single[0].Purchase.Quantity)
	}
	if double[0].Purchase.Quantity != 2 {
		t.Fatalf("double batch buys %v bunches, want 2", double[0].Purchase.Quantity)
	}
}
