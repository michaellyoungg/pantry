package recipe

import (
	"net/http"
	"strings"
	"testing"
)

func TestCreateRoundTripsDiscoveryMetadata(t *testing.T) {
	srv, _ := newTestServer(t)
	body := `{"title":"Pad Thai","ingredients":[{"quantity":1,"unit":"","item":"noodles"}],
	          "cuisine":"Thai","totalMinutes":25,"tags":["Gluten Free","weeknight"],
	          "sourceUrl":"https://example.com/pad-thai"}`
	resp := doAuth(t, http.MethodPost, srv.URL+"/recipes", strings.NewReader(body))
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("status = %d, want 201", resp.StatusCode)
	}
	rec := decodeRecipe(t, resp)

	if rec.Cuisine != "thai" {
		t.Errorf("cuisine = %q, want thai (normalized)", rec.Cuisine)
	}
	if rec.TotalMinutes == nil || *rec.TotalMinutes != 25 {
		t.Errorf("totalMinutes = %v, want 25", rec.TotalMinutes)
	}
	if len(rec.Tags) != 2 || rec.Tags[0] != "gluten-free" || rec.Tags[1] != "weeknight" {
		t.Errorf("tags = %v, want [gluten-free weeknight]", rec.Tags)
	}
	if rec.SourceURL != "https://example.com/pad-thai" {
		t.Errorf("sourceUrl = %q", rec.SourceURL)
	}
}

func TestCreateLeavesDiscoveryMetadataAbsentWhenNotSupplied(t *testing.T) {
	srv, _ := newTestServer(t)
	resp := doAuth(t, http.MethodPost, srv.URL+"/recipes",
		strings.NewReader(`{"title":"Toast","ingredients":[]}`))
	rec := decodeRecipe(t, resp)

	if rec.TotalMinutes != nil {
		t.Errorf("totalMinutes = %d; an unstated cook time must stay unknown, not become 0", *rec.TotalMinutes)
	}
	if rec.Cuisine != "" || rec.SourceURL != "" {
		t.Errorf("unexpected metadata: %+v", rec)
	}
	if rec.Tags == nil {
		t.Error("tags is nil; the wire contract is [] so clients can map over it")
	}
}

func TestCreateRejectsAnUnusableSourceURL(t *testing.T) {
	srv, _ := newTestServer(t)
	for _, bad := range []string{"javascript:alert(1)", "not a url at all", "/relative"} {
		body := `{"title":"X","ingredients":[],"sourceUrl":"` + bad + `"}`
		resp := doAuth(t, http.MethodPost, srv.URL+"/recipes", strings.NewReader(body))
		resp.Body.Close()
		if resp.StatusCode != http.StatusBadRequest {
			t.Errorf("sourceUrl %q: status = %d, want 400", bad, resp.StatusCode)
		}
	}
}

func TestCreateRejectsANonPositiveTotalMinutes(t *testing.T) {
	srv, _ := newTestServer(t)
	resp := doAuth(t, http.MethodPost, srv.URL+"/recipes",
		strings.NewReader(`{"title":"X","ingredients":[],"totalMinutes":0}`))
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", resp.StatusCode)
	}
}

// Update replaces the whole recipe, so an omitted field clears it — the same
// contract servings established. Callers echo back what they want to keep.
func TestUpdateClearsDiscoveryMetadataThatIsOmitted(t *testing.T) {
	srv, _ := newTestServer(t)
	created := decodeRecipe(t, doAuth(t, http.MethodPost, srv.URL+"/recipes", strings.NewReader(
		`{"title":"Curry","ingredients":[],"cuisine":"thai","totalMinutes":40,"tags":["vegan"]}`)))

	resp := doAuth(t, http.MethodPut, srv.URL+"/recipes/"+created.ID,
		strings.NewReader(`{"title":"Curry","ingredients":[]}`))
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	updated := decodeRecipe(t, resp)

	if updated.Cuisine != "" || updated.TotalMinutes != nil || len(updated.Tags) != 0 {
		t.Errorf("omitted fields survived the update: %+v", updated)
	}
}

func TestUpdateRoundTripsDiscoveryMetadata(t *testing.T) {
	srv, _ := newTestServer(t)
	created := decodeRecipe(t, doAuth(t, http.MethodPost, srv.URL+"/recipes",
		strings.NewReader(`{"title":"Curry","ingredients":[]}`)))

	resp := doAuth(t, http.MethodPut, srv.URL+"/recipes/"+created.ID, strings.NewReader(
		`{"title":"Curry","ingredients":[],"cuisine":"Indian","totalMinutes":45,"tags":["Vegan","vegan"]}`))
	updated := decodeRecipe(t, resp)

	if updated.Cuisine != "indian" {
		t.Errorf("cuisine = %q, want indian", updated.Cuisine)
	}
	if updated.TotalMinutes == nil || *updated.TotalMinutes != 45 {
		t.Errorf("totalMinutes = %v, want 45", updated.TotalMinutes)
	}
	if len(updated.Tags) != 1 || updated.Tags[0] != "vegan" {
		t.Errorf("tags = %v, want [vegan] — duplicates must collapse after normalization", updated.Tags)
	}
}

// sourceRecipeId is server-owned provenance. Accepting it from a client would
// let anyone forge the idempotency key that clone-on-add relies on.
func TestCreateIgnoresAClientSuppliedSourceRecipeID(t *testing.T) {
	srv, _ := newTestServer(t)
	resp := doAuth(t, http.MethodPost, srv.URL+"/recipes", strings.NewReader(
		`{"title":"Forged","ingredients":[],"sourceRecipeId":"cat-garlic-bread"}`))
	rec := decodeRecipe(t, resp)
	if rec.SourceRecipeID != "" {
		t.Fatalf("SourceRecipeID = %q; clients must not be able to set it", rec.SourceRecipeID)
	}
}
