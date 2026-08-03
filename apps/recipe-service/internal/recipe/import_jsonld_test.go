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

// Recipe sites routinely HTML-encode entities inside JSON-LD text (e.g. the
// apostrophe in "World's" as &#39;). Those must be decoded so the preview shows
// clean text, not raw entities.
const pageEntities = `<html><head>
<script type="application/ld+json">
{"@type":"Recipe","name":"World&#39;s Best Lasagna",
 "recipeIngredient":["1 tbsp salt &amp; pepper"],
 "recipeInstructions":["Season &amp; bake."]}
</script></head></html>`

func TestExtractJSONLD_UnescapesEntities(t *testing.T) {
	got, ok := extractJSONLD([]byte(pageEntities))
	if !ok {
		t.Fatal("expected a Recipe node to be found")
	}
	if got.Title != "World's Best Lasagna" {
		t.Errorf("title = %q, want %q", got.Title, "World's Best Lasagna")
	}
	if len(got.IngredientLines) != 1 || got.IngredientLines[0] != "1 tbsp salt & pepper" {
		t.Errorf("ingredients = %v, want [%q]", got.IngredientLines, "1 tbsp salt & pepper")
	}
	if len(got.Steps) != 1 || got.Steps[0] != "Season & bake." {
		t.Errorf("steps = %v, want [%q]", got.Steps, "Season & bake.")
	}
}

// recipeYield is the field BL-0035 rides in on. It is absent from pageWithGraph,
// which doubles as the "no yield" case.
const pageWithYield = `<html><head>
<script type="application/ld+json">
{"@type":"Recipe","name":"Chili","recipeYield":"6 servings",
 "recipeIngredient":["1 lb beef"]}
</script></head></html>`

func TestExtractJSONLD_ExtractsRecipeYield(t *testing.T) {
	got, ok := extractJSONLD([]byte(pageWithYield))
	if !ok {
		t.Fatal("expected a Recipe node to be found")
	}
	if got.Servings == nil {
		t.Fatal("servings = nil, want 6")
	}
	if *got.Servings != 6 {
		t.Errorf("servings = %d, want 6", *got.Servings)
	}
}

func TestExtractJSONLD_NoYieldLeavesServingsUnknown(t *testing.T) {
	got, ok := extractJSONLD([]byte(pageWithGraph))
	if !ok {
		t.Fatal("expected a Recipe node to be found")
	}
	if got.Servings != nil {
		t.Errorf("servings = %d, want nil for a page with no recipeYield", *got.Servings)
	}
}
