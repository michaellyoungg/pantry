package recipe

import (
	"bytes"
	"encoding/json"
	"net/http"
	"testing"
)

func postMatch(t *testing.T, url, body string) (*http.Response, EquipmentMatchResult) {
	t.Helper()
	resp := doAuth(t, http.MethodPost, url+"/equipment/match", bytes.NewBufferString(body))
	t.Cleanup(func() { resp.Body.Close() })
	var out EquipmentMatchResult
	if resp.StatusCode == http.StatusOK {
		if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
			t.Fatalf("decode: %v", err)
		}
	}
	return resp, out
}

func seedTagged(t *testing.T, store Store, userID, title string, equip ...RecipeEquipment) Recipe {
	t.Helper()
	rec, err := store.CreateRecipe(t.Context(), userID, title, nil, nil, nil, equip, nil)
	if err != nil {
		t.Fatal(err)
	}
	return rec
}

func TestEquipmentMatch_ClassifiesOwnRecipes(t *testing.T) {
	srv, store := newTestServer(t)
	seedTagged(t, store, "user-a", "Roast chicken", eqReq("oven"))
	seedTagged(t, store, "user-a", "Brisket", eqReq("smoker"))
	seedTagged(t, store, "user-a", "Untagged")

	resp, got := postMatch(t, srv.URL, `{"owned":["oven"]}`)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	want := EquipmentCounts{Makeable: 1, Blocked: 1, Unknown: 1}
	if got.Counts != want {
		t.Fatalf("counts = %+v, want %+v", got.Counts, want)
	}
	byTitle := map[string]EquipmentMatch{}
	for _, m := range got.Recipes {
		byTitle[m.Title] = m
	}
	if byTitle["Roast chicken"].Status != FitMakeable {
		t.Errorf("Roast chicken = %q, want makeable", byTitle["Roast chicken"].Status)
	}
	if m := byTitle["Brisket"]; m.Status != FitBlocked || len(m.Missing) != 1 || m.Missing[0] != "smoker" {
		t.Errorf("Brisket = %+v, want blocked on [smoker]", m)
	}
	if byTitle["Untagged"].Status != FitUnknown {
		t.Errorf("Untagged = %q, want unknown — never a green light", byTitle["Untagged"].Status)
	}
}

func TestEquipmentMatch_IncludesTheSharedCatalog(t *testing.T) {
	// A new user owns no recipes; without the catalog the whole feature would
	// return nothing on the screen it is meant to power.
	srv, store := newTestServer(t)
	seedTagged(t, store, CatalogUserID, "Catalog roast", eqReq("oven"))

	_, got := postMatch(t, srv.URL, `{"owned":["oven"]}`)
	if len(got.Recipes) != 1 || got.Recipes[0].Title != "Catalog roast" {
		t.Fatalf("recipes = %+v, want the catalog roast", got.Recipes)
	}
}

func TestEquipmentMatch_DiscoversWhatANewDeviceUnlocks(t *testing.T) {
	srv, store := newTestServer(t)
	seedTagged(t, store, "user-a", "Sous-vide steak", eqReq("sous_vide_circulator"))
	seedTagged(t, store, "user-a", "Roast chicken", eqReq("oven"))

	_, got := postMatch(t, srv.URL,
		`{"owned":["oven","sous_vide_circulator"],"acquired":["sous_vide_circulator"]}`)
	if len(got.Recipes) != 1 || got.Recipes[0].Title != "Sous-vide steak" {
		t.Fatalf("recipes = %+v, want only the newly unlocked one", got.Recipes)
	}
	if got.Recipes[0].UnlockedBy[0] != "sous_vide_circulator" {
		t.Errorf("unlockedBy = %v", got.Recipes[0].UnlockedBy)
	}
	// The counts still describe everything, so the UI can be honest about scope.
	if got.Counts.Makeable != 2 {
		t.Errorf("counts.makeable = %d, want 2", got.Counts.Makeable)
	}
}

func TestEquipmentMatch_EmptyInventoryIsValid(t *testing.T) {
	// The first visit to My Kitchen owns nothing. That is a real answer
	// ("everything tagged is blocked"), not a bad request.
	srv, store := newTestServer(t)
	seedTagged(t, store, "user-a", "Roast chicken", eqReq("oven"))

	resp, got := postMatch(t, srv.URL, `{"owned":[]}`)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	if got.Counts.Blocked != 1 {
		t.Fatalf("counts = %+v, want one blocked", got.Counts)
	}
}

func TestEquipmentMatch_UnknownOwnedSlugDoesNotFail(t *testing.T) {
	srv, store := newTestServer(t)
	seedTagged(t, store, "user-a", "Roast chicken", eqReq("oven"))

	resp, got := postMatch(t, srv.URL, `{"owned":["oven","teleporter"]}`)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200 — a stale inventory slug must degrade, not 400", resp.StatusCode)
	}
	if got.Counts.Makeable != 1 {
		t.Fatalf("counts = %+v", got.Counts)
	}
}

func TestEquipmentMatch_RequiresServiceSecret(t *testing.T) {
	srv, _ := newTestServer(t)
	resp, err := http.Post(srv.URL+"/equipment/match", "application/json",
		bytes.NewBufferString(`{"owned":[]}`))
	if err != nil {
		t.Fatalf("POST /equipment/match: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", resp.StatusCode)
	}
}

func TestEquipmentMatch_EmptyResultSerializesAsArray(t *testing.T) {
	srv, _ := newTestServer(t)
	resp := doAuth(t, http.MethodPost, srv.URL+"/equipment/match", bytes.NewBufferString(`{"owned":[]}`))
	defer resp.Body.Close()
	var raw map[string]json.RawMessage
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if string(raw["recipes"]) != "[]" {
		t.Errorf("recipes = %s, want [] — null breaks the web contract", raw["recipes"])
	}
}
