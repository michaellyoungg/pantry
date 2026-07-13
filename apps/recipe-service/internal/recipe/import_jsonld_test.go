package recipe

import (
	"reflect"
	"testing"
)

const pageWithGraph = `<html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@graph":[
  {"@type":"WebPage","name":"ignore me"},
  {"@type":["Recipe","Thing"],"name":"Garlic Bread",
   "recipeIngredient":["2 cloves garlic, minced","1 loaf bread"],
   "recipeInstructions":[{"@type":"HowToStep","text":"Mince the garlic."},{"@type":"HowToStep","text":"Toast the bread."}]}
]}
</script></head><body></body></html>`

const pageNoRecipe = `<html><head>
<script type="application/ld+json">{"@type":"WebSite","name":"nope"}</script>
</head></html>`

func TestExtractJSONLD_Graph(t *testing.T) {
	got, ok := extractJSONLD([]byte(pageWithGraph))
	if !ok {
		t.Fatal("expected a Recipe node to be found")
	}
	if got.Title != "Garlic Bread" {
		t.Errorf("title = %q, want Garlic Bread", got.Title)
	}
	wantIng := []string{"2 cloves garlic, minced", "1 loaf bread"}
	if !reflect.DeepEqual(got.IngredientLines, wantIng) {
		t.Errorf("ingredients = %v, want %v", got.IngredientLines, wantIng)
	}
	wantSteps := []string{"Mince the garlic.", "Toast the bread."}
	if !reflect.DeepEqual(got.Steps, wantSteps) {
		t.Errorf("steps = %v, want %v", got.Steps, wantSteps)
	}
}

func TestExtractJSONLD_NoRecipe(t *testing.T) {
	if _, ok := extractJSONLD([]byte(pageNoRecipe)); ok {
		t.Fatal("expected no Recipe node")
	}
}
