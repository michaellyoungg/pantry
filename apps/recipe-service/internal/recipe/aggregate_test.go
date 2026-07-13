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
	want := []GroceryLine{{Item: "Garlic", Unit: "cloves", Quantity: 3, Aisle: "produce"}}
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
		{Item: "Garlic", Unit: "cloves", Quantity: 2, Aisle: "produce"},
		{Item: "Garlic", Unit: "grams", Quantity: 10, Aisle: "produce"},
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
	want := []GroceryLine{{Item: "Butter", Unit: "cup", Quantity: 0.75, Aisle: "dairy"}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}

func TestAggregate_MergesSynonyms(t *testing.T) {
	got := Aggregate([]Recipe{
		r("a", Ingredient{Quantity: 2, Unit: "cloves", Item: "garlic cloves"}),
		r("b", Ingredient{Quantity: 1, Unit: "cloves", Item: "fresh garlic"}),
	})
	want := []GroceryLine{{Item: "Garlic", Unit: "cloves", Quantity: 3, Aisle: "produce"}}
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
		{Item: "Garlic", Unit: "clove", Quantity: 2, Aisle: "produce"},
		{Item: "Garlic", Unit: "tbsp", Quantity: 1, Aisle: "produce"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}

func TestAggregate_SortsByAisleThenFirstSeen(t *testing.T) {
	// eggs (unknown -> other) seen first, milk (dairy) second; dairy sorts before other.
	got := Aggregate([]Recipe{
		r("a",
			Ingredient{Quantity: 1, Unit: "", Item: "eggs"},
			Ingredient{Quantity: 1, Unit: "cup", Item: "milk"},
		),
		r("b", Ingredient{Quantity: 2, Unit: "", Item: "eggs"}),
	})
	want := []GroceryLine{
		{Item: "Milk", Unit: "cup", Quantity: 1, Aisle: "dairy"},
		{Item: "eggs", Unit: "", Quantity: 3, Aisle: "other"},
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
	want := []GroceryLine{{Item: "Garlic", Unit: "cloves", Quantity: 4, Aisle: "produce"}}
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
	want := []GroceryLine{{Item: "Garlic", Unit: "cloves", Quantity: 3, Aisle: "produce"}}
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
