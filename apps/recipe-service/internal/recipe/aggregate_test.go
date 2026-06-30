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
	want := []GroceryLine{{Item: "garlic", Unit: "cloves", Quantity: 3}}
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
		{Item: "garlic", Unit: "cloves", Quantity: 2},
		{Item: "garlic", Unit: "grams", Quantity: 10},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}

func TestAggregate_MatchIsCaseAndSpaceInsensitive(t *testing.T) {
	got := Aggregate([]Recipe{
		r("a", Ingredient{Quantity: 1, Unit: "Cup", Item: " Flour "}),
		r("b", Ingredient{Quantity: 2, Unit: "cup", Item: "flour"}),
	})
	want := []GroceryLine{{Item: "flour", Unit: "cup", Quantity: 3}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}

func TestAggregate_PreservesFirstSeenOrder(t *testing.T) {
	got := Aggregate([]Recipe{
		r("a",
			Ingredient{Quantity: 1, Unit: "", Item: "eggs"},
			Ingredient{Quantity: 1, Unit: "cup", Item: "milk"},
		),
		r("b", Ingredient{Quantity: 2, Unit: "", Item: "eggs"}),
	})
	want := []GroceryLine{
		{Item: "eggs", Unit: "", Quantity: 3},
		{Item: "milk", Unit: "cup", Quantity: 1},
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
