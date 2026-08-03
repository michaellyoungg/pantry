package recipe

import (
	"context"
	"reflect"
	"testing"
)

func TestPostgres_SeedsEquipmentCatalog(t *testing.T) {
	ctx := context.Background()
	s := newTestPostgres(t)

	var count int
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM equipment`).Scan(&count); err != nil {
		t.Fatalf("count equipment: %v", err)
	}
	if count != len(EquipmentList()) {
		t.Fatalf("equipment rows = %d, want %d", count, len(EquipmentList()))
	}
	var aliases []string
	if err := s.pool.QueryRow(ctx,
		`SELECT aliases FROM equipment WHERE id = 'slow_cooker'`).Scan(&aliases); err != nil {
		t.Fatalf("read aliases: %v", err)
	}
	if len(aliases) == 0 {
		t.Fatal("slow_cooker has no aliases in the database")
	}
}

func TestPostgres_TagsRoundTrip(t *testing.T) {
	ctx := context.Background()
	s := newTestPostgres(t)

	created, err := s.CreateRecipe(ctx, "user-a", "Pulled Pork", nil, []string{"Into the crock pot."},
		[]RecipeEquipment{{ID: "tongs", Required: false}, {ID: "slow_cooker", Required: true}},
		[]string{"slow_cook"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	want := []RecipeEquipment{{ID: "slow_cooker", Required: true}, {ID: "tongs", Required: false}}
	if !reflect.DeepEqual(created.Equipment, want) {
		t.Fatalf("created equipment = %+v, want %+v", created.Equipment, want)
	}

	got, err := s.GetRecipe(ctx, created.ID, "user-a")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if !reflect.DeepEqual(got.Equipment, want) {
		t.Fatalf("read-back equipment = %+v, want %+v", got.Equipment, want)
	}
	if !reflect.DeepEqual(got.Methods, []string{"slow_cook"}) {
		t.Fatalf("read-back methods = %v, want [slow_cook]", got.Methods)
	}

	list, err := s.ListRecipes(ctx, "user-a")
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(list) != 1 || !reflect.DeepEqual(list[0].Equipment, want) {
		t.Fatalf("list equipment = %+v, want %+v", list, want)
	}
}

func TestPostgres_UpdateReplacesTags(t *testing.T) {
	ctx := context.Background()
	s := newTestPostgres(t)

	created, err := s.CreateRecipe(ctx, "user-a", "Roast", nil, nil,
		[]RecipeEquipment{{ID: "oven", Required: true}, {ID: "roasting_pan", Required: true}},
		[]string{"roast", "bake"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	updated, err := s.UpdateRecipe(ctx, created.ID, "user-a", "Smoked", nil, nil,
		[]RecipeEquipment{{ID: "smoker", Required: true}}, []string{"smoke"})
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if len(updated.Equipment) != 1 || updated.Equipment[0].ID != "smoker" {
		t.Fatalf("equipment = %+v, want only the smoker", updated.Equipment)
	}
	if !reflect.DeepEqual(updated.Methods, []string{"smoke"}) {
		t.Fatalf("methods = %v, want [smoke]", updated.Methods)
	}
}

func TestPostgres_DeleteCascadesTags(t *testing.T) {
	ctx := context.Background()
	s := newTestPostgres(t)

	created, err := s.CreateRecipe(ctx, "user-a", "Roast", nil, nil,
		[]RecipeEquipment{{ID: "oven", Required: true}}, []string{"roast"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if err := s.DeleteRecipe(ctx, created.ID, "user-a"); err != nil {
		t.Fatalf("delete: %v", err)
	}
	for _, table := range []string{"recipe_equipment", "recipe_methods"} {
		var n int
		if err := s.pool.QueryRow(ctx,
			`SELECT count(*) FROM `+table+` WHERE recipe_id = $1`, created.ID).Scan(&n); err != nil {
			t.Fatalf("count %s: %v", table, err)
		}
		if n != 0 {
			t.Errorf("%s still holds %d rows for the deleted recipe", table, n)
		}
	}
	// The catalog is reference data and must survive a recipe delete.
	var equipCount int
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM equipment`).Scan(&equipCount); err != nil {
		t.Fatalf("count equipment: %v", err)
	}
	if equipCount != len(EquipmentList()) {
		t.Errorf("equipment rows = %d after delete, want %d", equipCount, len(EquipmentList()))
	}
}

func TestPostgres_UpsertCarriesTags(t *testing.T) {
	ctx := context.Background()
	s := newTestPostgres(t)

	rec := Recipe{
		ID: "cat-x", UserID: CatalogUserID, Title: "Catalog dish",
		Equipment: []RecipeEquipment{{ID: "oven", Required: true}},
		Methods:   []string{"bake"},
	}
	if err := s.UpsertRecipe(ctx, rec); err != nil {
		t.Fatalf("upsert: %v", err)
	}
	rec.Equipment = []RecipeEquipment{{ID: "grill", Required: true}}
	rec.Methods = []string{"grill"}
	if err := s.UpsertRecipe(ctx, rec); err != nil {
		t.Fatalf("re-upsert: %v", err)
	}
	got, err := s.GetRecipe(ctx, "cat-x", CatalogUserID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if len(got.Equipment) != 1 || got.Equipment[0].ID != "grill" {
		t.Fatalf("equipment = %+v, want only the grill after re-seed", got.Equipment)
	}
	if !reflect.DeepEqual(got.Methods, []string{"grill"}) {
		t.Fatalf("methods = %v, want [grill]", got.Methods)
	}
}
