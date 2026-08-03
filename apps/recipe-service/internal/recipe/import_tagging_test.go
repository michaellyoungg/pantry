package recipe

import (
	"context"
	"reflect"
	"testing"
)

// One fixture per detection path: JSON-LD cookingMethod, the keyword scan over
// step text, and neither.

const pageWithCookingMethod = `<html><head>
<script type="application/ld+json">
{"@type":"Recipe","name":"Sunday Roast",
 "cookingMethod":"Roasting",
 "recipeIngredient":["1 kg beef"],
 "recipeInstructions":["Season the beef.","Rest before carving."]}
</script></head></html>`

const pageWithEquipmentInSteps = `<html><head>
<script type="application/ld+json">
{"@type":"Recipe","name":"Pulled Pork",
 "recipeIngredient":["2 kg pork shoulder"],
 "recipeInstructions":["Rub the pork and refrigerate.","Add it to the crock pot and cook on low for 8 hours."]}
</script></head></html>`

const pageWithNoTags = `<html><head>
<script type="application/ld+json">
{"@type":"Recipe","name":"Fruit Salad",
 "recipeIngredient":["2 apples"],
 "recipeInstructions":["Chop the fruit.","Toss and serve."]}
</script></head></html>`

func equipIDs(equip []RecipeEquipment) []string {
	out := make([]string, 0, len(equip))
	for _, e := range equip {
		out = append(out, e.ID)
	}
	return out
}

func TestImporter_TagsFromJSONLDCookingMethod(t *testing.T) {
	imp := NewImporter(fakeFetcher{body: []byte(pageWithCookingMethod)}, nil)
	rec, err := imp.Import(context.Background(), "u1", "https://example.com/r")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if want := []string{"roast"}; !reflect.DeepEqual(rec.Methods, want) {
		t.Errorf("methods = %v, want %v — cookingMethod was not mapped onto the enum", rec.Methods, want)
	}
	if len(rec.Equipment) != 0 {
		t.Errorf("equipment = %v, want none — the steps name no hardware", equipIDs(rec.Equipment))
	}
}

func TestImporter_TagsFromStepKeywordScan(t *testing.T) {
	imp := NewImporter(fakeFetcher{body: []byte(pageWithEquipmentInSteps)}, nil)
	rec, err := imp.Import(context.Background(), "u1", "https://example.com/r")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if want := []string{"slow_cooker"}; !reflect.DeepEqual(equipIDs(rec.Equipment), want) {
		t.Errorf("equipment = %v, want %v", equipIDs(rec.Equipment), want)
	}
	if want := []string{"slow_cook"}; !reflect.DeepEqual(rec.Methods, want) {
		t.Errorf("methods = %v, want %v", rec.Methods, want)
	}
}

func TestImporter_NoTagsWhenNothingMatches(t *testing.T) {
	imp := NewImporter(fakeFetcher{body: []byte(pageWithNoTags)}, nil)
	rec, err := imp.Import(context.Background(), "u1", "https://example.com/r")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// Non-nil empties, so the preview serializes as [] and the form renders
	// "nothing detected" rather than crashing on null.
	if rec.Equipment == nil || len(rec.Equipment) != 0 {
		t.Errorf("equipment = %+v, want an empty slice", rec.Equipment)
	}
	if rec.Methods == nil || len(rec.Methods) != 0 {
		t.Errorf("methods = %+v, want an empty slice", rec.Methods)
	}
}

// The LLM fallback path (BL-0044 will tag with a model; today the extractor
// only returns title/ingredients/steps) still gets deterministic tags, because
// the scan runs over whatever steps the extractor produced.
func TestImporter_ScansLLMExtractedSteps(t *testing.T) {
	ex := fakeExtractor{rec: ExtractedRecipe{
		Title:       "Steak",
		Ingredients: []Ingredient{{Quantity: 1, Unit: "", Item: "ribeye"}},
		Steps:       []string{"Cook sous vide at 54C for two hours.", "Sear in a cast iron skillet."},
	}}
	imp := NewImporter(fakeFetcher{body: []byte("<html>no json-ld</html>")}, ex)
	rec, err := imp.Import(context.Background(), "u1", "https://example.com/r")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if want := []string{"cast_iron_skillet", "sous_vide_circulator"}; !reflect.DeepEqual(equipIDs(rec.Equipment), want) {
		t.Errorf("equipment = %v, want %v", equipIDs(rec.Equipment), want)
	}
	if want := []string{"sous_vide"}; !reflect.DeepEqual(rec.Methods, want) {
		t.Errorf("methods = %v, want %v", rec.Methods, want)
	}
}

func TestExtractJSONLD_ReadsCookingMethodList(t *testing.T) {
	page := `<html><head><script type="application/ld+json">
	{"@type":"Recipe","name":"Brisket","recipeIngredient":["1 brisket"],
	 "cookingMethod":["Smoking","Slow cooking"]}
	</script></head></html>`
	got, ok := extractJSONLD([]byte(page))
	if !ok {
		t.Fatal("expected a Recipe node")
	}
	if want := []string{"Smoking", "Slow cooking"}; !reflect.DeepEqual(got.CookingMethods, want) {
		t.Fatalf("cookingMethods = %v, want %v", got.CookingMethods, want)
	}
	if want := []string{"smoke", "slow_cook"}; !reflect.DeepEqual(equipmentCatalog.MethodsFromJSONLD(got.CookingMethods), want) {
		t.Fatalf("mapped = %v, want %v", equipmentCatalog.MethodsFromJSONLD(got.CookingMethods), want)
	}
}
