package recipe

import (
	"reflect"
	"strings"
	"testing"
)

func TestEquipmentCatalog_LoadsAndValidates(t *testing.T) {
	c := equipmentCatalog
	if len(c.List()) < 20 {
		t.Fatalf("equipment catalog is too thin to be useful: %d entries", len(c.List()))
	}
	// The method enum is closed: BL-0042's rules key on exactly these values.
	want := []string{"bake", "roast", "grill", "smoke", "sous_vide", "slow_cook",
		"pressure_cook", "fry", "saute", "boil", "marinate", "no_cook"}
	got := make([]string, 0, len(c.Methods()))
	for _, m := range c.Methods() {
		got = append(got, m.ID)
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("method enum = %v, want %v", got, want)
	}
	for _, e := range c.List() {
		if !equipmentCategories[e.Category] {
			t.Errorf("equipment %q: bad category %q", e.ID, e.Category)
		}
		if len(e.Aliases) == 0 {
			t.Errorf("equipment %q: no aliases, so import can never detect it", e.ID)
		}
	}
}

func TestLoadEquipmentCatalog_RejectsDuplicateAlias(t *testing.T) {
	raw := []byte(`{
	  "methods": [{"id":"bake","name":"Bake","aliases":["bake"]}],
	  "equipment": [
	    {"id":"oven","name":"Oven","category":"appliance","aliases":["oven"]},
	    {"id":"toaster_oven","name":"Toaster oven","category":"appliance","aliases":["oven"]}
	  ]}`)
	_, err := loadEquipmentCatalog(raw)
	if err == nil || !strings.Contains(err.Error(), "already belongs to") {
		t.Fatalf("err = %v, want a duplicate-alias error", err)
	}
}

func TestLoadEquipmentCatalog_RejectsUnknownImpliedMethod(t *testing.T) {
	raw := []byte(`{
	  "methods": [{"id":"bake","name":"Bake","aliases":["bake"]}],
	  "equipment": [{"id":"smoker","name":"Smoker","category":"appliance","aliases":["smoker"],"implies":["smoke"]}]}`)
	_, err := loadEquipmentCatalog(raw)
	if err == nil || !strings.Contains(err.Error(), "unknown method") {
		t.Fatalf("err = %v, want an unknown-method error", err)
	}
}

func TestLoadEquipmentCatalog_RejectsUnknownCategory(t *testing.T) {
	raw := []byte(`{
	  "methods": [],
	  "equipment": [{"id":"oven","name":"Oven","category":"gadget","aliases":["oven"]}]}`)
	_, err := loadEquipmentCatalog(raw)
	if err == nil || !strings.Contains(err.Error(), "unknown category") {
		t.Fatalf("err = %v, want an unknown-category error", err)
	}
}

func TestDetectTags(t *testing.T) {
	ids := func(equip []RecipeEquipment) []string {
		out := make([]string, 0, len(equip))
		for _, e := range equip {
			out = append(out, e.ID)
		}
		return out
	}

	tests := []struct {
		name      string
		steps     []string
		wantEquip []string
		wantMeth  []string
	}{
		{
			name:      "crock pot implies the slow cooker and slow_cook",
			steps:     []string{"Add everything to the crock pot and cook on low for 8 hours."},
			wantEquip: []string{"slow_cooker"},
			wantMeth:  []string{"slow_cook"},
		},
		{
			name:      "immersion circulator implies sous vide",
			steps:     []string{"Seal the steak and drop it in the immersion circulator at 54C."},
			wantEquip: []string{"sous_vide_circulator"},
			wantMeth:  []string{"sous_vide"},
		},
		{
			name:      "preheating the oven implies baking",
			steps:     []string{"Preheat the oven to 400F.", "Bake for 20 minutes."},
			wantEquip: []string{"oven"},
			wantMeth:  []string{"bake"},
		},
		{
			name:      "a more specific alias claims the phrase",
			steps:     []string{"Heat the cast iron skillet until very hot."},
			wantEquip: []string{"cast_iron_skillet"},
			wantMeth:  []string{},
		},
		{
			name:      "the bare alias still matches its own mention",
			steps:     []string{"Sear in a cast iron skillet, then wipe out the skillet."},
			wantEquip: []string{"cast_iron_skillet", "skillet"},
			wantMeth:  []string{},
		},
		{
			name:      "grilled cheese is not a grill recipe",
			steps:     []string{"Build the grilled cheese and cook it in a skillet over medium heat."},
			wantEquip: []string{"skillet", "stovetop"},
			wantMeth:  []string{},
		},
		{
			name:      "no known hardware detects nothing",
			steps:     []string{"Toss everything together and serve."},
			wantEquip: []string{},
			wantMeth:  []string{},
		},
		{
			name:      "no steps detects nothing",
			steps:     nil,
			wantEquip: []string{},
			wantMeth:  []string{},
		},
		{
			name:      "methods come back in enum order, not detection order",
			steps:     []string{"Marinate overnight, then grill over the coals and finish in the oven."},
			wantEquip: []string{"grill", "oven"},
			wantMeth:  []string{"bake", "grill", "marinate"},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			equip, methods := equipmentCatalog.DetectTags(tc.steps)
			if !reflect.DeepEqual(ids(equip), tc.wantEquip) {
				t.Errorf("equipment = %v, want %v", ids(equip), tc.wantEquip)
			}
			if !reflect.DeepEqual(methods, tc.wantMeth) {
				t.Errorf("methods = %v, want %v", methods, tc.wantMeth)
			}
		})
	}
}

func TestDetectTags_DetectedEquipmentIsRequired(t *testing.T) {
	equip, _ := equipmentCatalog.DetectTags([]string{"Preheat the oven."})
	if len(equip) != 1 || !equip[0].Required {
		t.Fatalf("detected equipment = %+v, want a single required tag", equip)
	}
}

func TestMethodsFromJSONLD(t *testing.T) {
	tests := []struct {
		name   string
		values []string
		want   []string
	}{
		{"schema.org value maps onto the enum", []string{"Roasting"}, []string{"roast"}},
		{"multi-word value", []string{"Sous vide"}, []string{"sous_vide"}},
		{"unknown vocabulary is dropped", []string{"Spatchcocking"}, []string{}},
		{"duplicates collapse", []string{"Baking", "bake"}, []string{"bake"}},
		{"empty input", nil, []string{}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := equipmentCatalog.MethodsFromJSONLD(tc.values); !reflect.DeepEqual(got, tc.want) {
				t.Errorf("MethodsFromJSONLD(%v) = %v, want %v", tc.values, got, tc.want)
			}
		})
	}
}

func TestValidateTags(t *testing.T) {
	if err := ValidateTags([]RecipeEquipment{{ID: "oven", Required: true}}, []string{"bake"}); err != nil {
		t.Fatalf("valid tags rejected: %v", err)
	}
	if err := ValidateTags([]RecipeEquipment{{ID: "teleporter"}}, nil); err == nil {
		t.Error("unknown equipment accepted")
	}
	if err := ValidateTags(nil, []string{"spatchcock"}); err == nil {
		t.Error("unknown method accepted — the enum is supposed to be closed")
	}
}

func TestNormEquipment_DedupesAndSorts(t *testing.T) {
	got := normEquipment([]RecipeEquipment{
		{ID: "sheet_pan", Required: false},
		{ID: "oven", Required: true},
		{ID: "sheet_pan", Required: true}, // required wins over the optional duplicate
	})
	want := []RecipeEquipment{{ID: "oven", Required: true}, {ID: "sheet_pan", Required: true}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("normEquipment = %+v, want %+v", got, want)
	}
	if got := normEquipment(nil); got == nil || len(got) != 0 {
		t.Fatalf("normEquipment(nil) = %+v, want an empty slice so JSON stays []", got)
	}
}

func TestNormMethods_DedupesAndOrders(t *testing.T) {
	got := normMethods([]string{"marinate", "bake", "marinate"})
	if want := []string{"bake", "marinate"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("normMethods = %v, want %v", got, want)
	}
	if got := normMethods(nil); got == nil || len(got) != 0 {
		t.Fatalf("normMethods(nil) = %v, want an empty slice so JSON stays []", got)
	}
}

func TestCatalogEntriesAreTagged(t *testing.T) {
	recs, err := LoadCatalog()
	if err != nil {
		t.Fatalf("LoadCatalog: %v", err)
	}
	for _, r := range recs {
		if len(r.Methods) == 0 {
			t.Errorf("catalog recipe %q has no cooking method", r.ID)
		}
		if len(r.Equipment) == 0 {
			t.Errorf("catalog recipe %q has no equipment", r.ID)
		}
	}
}
