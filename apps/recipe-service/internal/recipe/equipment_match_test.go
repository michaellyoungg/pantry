package recipe

import (
	"reflect"
	"testing"
)

func mkRecipe(id string, equip ...RecipeEquipment) Recipe {
	return Recipe{ID: id, Title: id, Equipment: normEquipment(equip)}
}

func eqReq(id string) RecipeEquipment {
	return RecipeEquipment{ID: id, Required: true}
}

func eqOpt(id string) RecipeEquipment {
	return RecipeEquipment{ID: id, Required: false}
}

func matchIDs(ms []EquipmentMatch) []string {
	out := make([]string, len(ms))
	for i, m := range ms {
		out[i] = m.ID
	}
	return out
}

func TestClassifyRecipeUntaggedIsUnknownNotMakeable(t *testing.T) {
	// The honesty rule: a recipe whose equipment was never detected tells us
	// nothing. Calling it makeable would turn missing data into a green light.
	status, missing := ClassifyRecipe(mkRecipe("r1"), ownedSet([]string{"oven"}))
	if status != FitUnknown {
		t.Fatalf("status = %q, want %q", status, FitUnknown)
	}
	if len(missing) != 0 {
		t.Fatalf("missing = %v, want empty", missing)
	}
}

func TestClassifyRecipeAllRequiredOwned(t *testing.T) {
	r := mkRecipe("r1", eqReq("oven"), eqReq("sheet_pan"))
	status, missing := ClassifyRecipe(r, ownedSet([]string{"oven", "sheet_pan", "blender"}))
	if status != FitMakeable {
		t.Fatalf("status = %q, want %q", status, FitMakeable)
	}
	if len(missing) != 0 {
		t.Fatalf("missing = %v, want empty", missing)
	}
}

func TestClassifyRecipeMissingRequiredBlocks(t *testing.T) {
	r := mkRecipe("r1", eqReq("oven"), eqReq("stand_mixer"))
	status, missing := ClassifyRecipe(r, ownedSet([]string{"oven"}))
	if status != FitBlocked {
		t.Fatalf("status = %q, want %q", status, FitBlocked)
	}
	if !reflect.DeepEqual(missing, []string{"stand_mixer"}) {
		t.Fatalf("missing = %v, want [stand_mixer]", missing)
	}
}

func TestClassifyRecipeOptionalEquipmentNeverBlocks(t *testing.T) {
	// "a grill pan works too" must not stop you cooking.
	r := mkRecipe("r1", eqReq("oven"), eqOpt("stand_mixer"))
	status, missing := ClassifyRecipe(r, ownedSet([]string{"oven"}))
	if status != FitMakeable {
		t.Fatalf("status = %q, want %q", status, FitMakeable)
	}
	if len(missing) != 0 {
		t.Fatalf("missing = %v, want empty", missing)
	}
}

func TestClassifyRecipeOnlyOptionalTagsIsMakeableNotUnknown(t *testing.T) {
	// Tags exist, so detection did run — nothing required means nothing blocks.
	status, _ := ClassifyRecipe(mkRecipe("r1", eqOpt("blender")), ownedSet(nil))
	if status != FitMakeable {
		t.Fatalf("status = %q, want %q", status, FitMakeable)
	}
}

func TestClassifyRecipeEmptyInventoryBlocksEverythingTagged(t *testing.T) {
	status, missing := ClassifyRecipe(mkRecipe("r1", eqReq("oven")), ownedSet(nil))
	if status != FitBlocked {
		t.Fatalf("status = %q, want %q", status, FitBlocked)
	}
	if !reflect.DeepEqual(missing, []string{"oven"}) {
		t.Fatalf("missing = %v", missing)
	}
}

func TestMatchRecipesCountsEveryRecipeIncludingUnknown(t *testing.T) {
	recs := []Recipe{
		mkRecipe("makeable", eqReq("oven")),
		mkRecipe("blocked", eqReq("smoker")),
		mkRecipe("untagged"),
		mkRecipe("untagged2"),
	}
	res := MatchRecipes(recs, []string{"oven"}, nil)
	want := EquipmentCounts{Makeable: 1, Blocked: 1, Unknown: 2}
	if res.Counts != want {
		t.Fatalf("counts = %+v, want %+v", res.Counts, want)
	}
	if len(res.Recipes) != 4 {
		t.Fatalf("returned %d recipes, want all 4", len(res.Recipes))
	}
}

func TestMatchRecipesOrdersMakeableThenUnknownThenBlocked(t *testing.T) {
	recs := []Recipe{
		mkRecipe("b-blocked", eqReq("smoker")),
		mkRecipe("c-unknown"),
		mkRecipe("a-makeable", eqReq("oven")),
	}
	res := MatchRecipes(recs, []string{"oven"}, nil)
	want := []string{"a-makeable", "c-unknown", "b-blocked"}
	if got := matchIDs(res.Recipes); !reflect.DeepEqual(got, want) {
		t.Fatalf("order = %v, want %v", got, want)
	}
}

func TestMatchRecipesUnknownOwnedSlugIsIgnored(t *testing.T) {
	// Inventory rows are written by Convex, which does not carry the catalog and
	// so cannot reject a stale slug. An unknown slug satisfies nothing; it must
	// not 500 or otherwise break the whole surface.
	res := MatchRecipes([]Recipe{mkRecipe("r1", eqReq("oven"))}, []string{"oven", "flux_capacitor"}, nil)
	if res.Recipes[0].Status != FitMakeable {
		t.Fatalf("status = %q", res.Recipes[0].Status)
	}
}

func TestMatchRecipesAcquiredReturnsOnlyWhatItUnlocks(t *testing.T) {
	recs := []Recipe{
		// Newly possible: the circulator was the only thing missing.
		mkRecipe("unlocked", eqReq("oven"), eqReq("sous_vide_circulator")),
		// Already possible before the new device — not "new to your kitchen".
		mkRecipe("already", eqReq("oven")),
		// Still blocked by something else the user doesn't own.
		mkRecipe("still-blocked", eqReq("sous_vide_circulator"), eqReq("smoker")),
		// No tags: a device can never be shown as unlocking an unknown recipe.
		mkRecipe("untagged"),
	}
	res := MatchRecipes(recs, []string{"oven", "sous_vide_circulator"}, []string{"sous_vide_circulator"})
	if got := matchIDs(res.Recipes); !reflect.DeepEqual(got, []string{"unlocked"}) {
		t.Fatalf("unlocked = %v, want [unlocked]", got)
	}
	if got := res.Recipes[0].UnlockedBy; !reflect.DeepEqual(got, []string{"sous_vide_circulator"}) {
		t.Fatalf("unlockedBy = %v", got)
	}
}

func TestMatchRecipesAcquiredKeepsHonestCountsOverEverything(t *testing.T) {
	// The filtered list is the headline; the counts still describe the whole
	// library so the UI can say how much it genuinely doesn't know about.
	recs := []Recipe{
		mkRecipe("unlocked", eqReq("sous_vide_circulator")),
		mkRecipe("untagged"),
	}
	res := MatchRecipes(recs, []string{"sous_vide_circulator"}, []string{"sous_vide_circulator"})
	want := EquipmentCounts{Makeable: 1, Blocked: 0, Unknown: 1}
	if res.Counts != want {
		t.Fatalf("counts = %+v, want %+v", res.Counts, want)
	}
}

func TestMatchRecipesAcquiredOptionalTagDoesNotCountAsUnlocking(t *testing.T) {
	// You could always make it; the new toy is merely an alternative.
	recs := []Recipe{mkRecipe("r1", eqReq("oven"), eqOpt("sous_vide_circulator"))}
	res := MatchRecipes(recs, []string{"oven", "sous_vide_circulator"}, []string{"sous_vide_circulator"})
	if len(res.Recipes) != 0 {
		t.Fatalf("returned %v, want none", matchIDs(res.Recipes))
	}
}

func TestMatchRecipesAcquiredCapsTheHeadlineList(t *testing.T) {
	recs := make([]Recipe, maxEquipmentUnlocks+5)
	for i := range recs {
		recs[i] = mkRecipe(string(rune('a'+i%26))+string(rune('a'+i/26)), eqReq("smoker"))
	}
	res := MatchRecipes(recs, []string{"smoker"}, []string{"smoker"})
	if len(res.Recipes) != maxEquipmentUnlocks {
		t.Fatalf("returned %d, want cap %d", len(res.Recipes), maxEquipmentUnlocks)
	}
	if res.Counts.Makeable != len(recs) {
		t.Fatalf("counts.makeable = %d, want %d — the cap must not distort the counts",
			res.Counts.Makeable, len(recs))
	}
}

func TestMatchRecipesNilSlicesMarshalAsEmpty(t *testing.T) {
	res := MatchRecipes(nil, nil, nil)
	if res.Recipes == nil {
		t.Fatal("Recipes is nil; the wire contract is []")
	}
	m := MatchRecipes([]Recipe{mkRecipe("r1", eqReq("oven"))}, nil, nil).Recipes[0]
	if m.Missing == nil || m.UnlockedBy == nil {
		t.Fatalf("missing=%v unlockedBy=%v; both must marshal as []", m.Missing, m.UnlockedBy)
	}
}
