package recipe

import (
	"bytes"
	"encoding/json"
	"net/http"
	"testing"
)

func TestListEquipment_ReturnsCatalog(t *testing.T) {
	srv, _ := newTestServer(t)
	resp := doAuth(t, http.MethodGet, srv.URL+"/equipment", nil)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	var got []Equipment
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(got) != len(EquipmentList()) {
		t.Fatalf("returned %d entries, want %d", len(got), len(EquipmentList()))
	}
	for _, e := range got {
		if e.ID == "sous_vide_circulator" && e.Name == "Sous-vide circulator" {
			return
		}
	}
	t.Error("catalog response is missing the sous-vide circulator")
}

func TestListEquipment_RequiresServiceSecret(t *testing.T) {
	srv, _ := newTestServer(t)
	resp, err := http.Get(srv.URL + "/equipment")
	if err != nil {
		t.Fatalf("GET /equipment: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", resp.StatusCode)
	}
}

func TestCreateRecipe_PersistsAndReturnsTags(t *testing.T) {
	srv, _ := newTestServer(t)
	body := `{"title":"Pulled Pork","ingredients":[{"quantity":2,"unit":"kg","item":"pork shoulder"}],
	          "equipment":[{"id":"slow_cooker","required":true},{"id":"tongs","required":false}],
	          "methods":["slow_cook"]}`
	resp := doAuth(t, http.MethodPost, srv.URL+"/recipes", bytes.NewBufferString(body))
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("status = %d, want 201", resp.StatusCode)
	}
	var rec Recipe
	if err := json.NewDecoder(resp.Body).Decode(&rec); err != nil {
		t.Fatalf("decode: %v", err)
	}
	// Sorted by id, and the optional tag keeps its required=false.
	if len(rec.Equipment) != 2 || rec.Equipment[0].ID != "slow_cooker" || rec.Equipment[1].ID != "tongs" {
		t.Fatalf("equipment = %+v, want slow_cooker then tongs", rec.Equipment)
	}
	if rec.Equipment[1].Required {
		t.Error("tongs came back required; the optional flag was dropped")
	}
	if len(rec.Methods) != 1 || rec.Methods[0] != "slow_cook" {
		t.Fatalf("methods = %v, want [slow_cook]", rec.Methods)
	}
}

func TestCreateRecipe_NoTagsSerializesAsEmptyArrays(t *testing.T) {
	srv, _ := newTestServer(t)
	body := `{"title":"Toast","ingredients":[]}`
	resp := doAuth(t, http.MethodPost, srv.URL+"/recipes", bytes.NewBufferString(body))
	defer resp.Body.Close()
	var raw map[string]json.RawMessage
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		t.Fatalf("decode: %v", err)
	}
	for _, field := range []string{"equipment", "methods"} {
		if string(raw[field]) != "[]" {
			t.Errorf("%s = %s, want [] — null breaks the web contract", field, raw[field])
		}
	}
}

func TestCreateRecipe_RejectsUnknownTags(t *testing.T) {
	srv, _ := newTestServer(t)
	tests := map[string]string{
		"unknown equipment": `{"title":"X","ingredients":[],"equipment":[{"id":"teleporter","required":true}]}`,
		"unknown method":    `{"title":"X","ingredients":[],"methods":["spatchcock"]}`,
	}
	for name, body := range tests {
		t.Run(name, func(t *testing.T) {
			resp := doAuth(t, http.MethodPost, srv.URL+"/recipes", bytes.NewBufferString(body))
			defer resp.Body.Close()
			if resp.StatusCode != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400", resp.StatusCode)
			}
		})
	}
}

func TestUpdateRecipe_ReplacesTags(t *testing.T) {
	srv, store := newTestServer(t)
	rec, _ := store.CreateRecipe(t.Context(), "user-a", "Roast", nil, nil, nil,
		[]RecipeEquipment{{ID: "oven", Required: true}}, []string{"roast"})

	body := `{"title":"Roast","ingredients":[],"equipment":[{"id":"smoker","required":true}],"methods":["smoke"]}`
	resp := doAuth(t, http.MethodPut, srv.URL+"/recipes/"+rec.ID, bytes.NewBufferString(body))
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	var got Recipe
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(got.Equipment) != 1 || got.Equipment[0].ID != "smoker" {
		t.Fatalf("equipment = %+v, want only the smoker — tags replace, they do not merge", got.Equipment)
	}
	if len(got.Methods) != 1 || got.Methods[0] != "smoke" {
		t.Fatalf("methods = %v, want [smoke]", got.Methods)
	}
}
