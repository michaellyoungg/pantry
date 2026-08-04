package recipe

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

func postJSON(t *testing.T, url, body string) *http.Response {
	t.Helper()
	return doAuth(t, http.MethodPost, url, strings.NewReader(body))
}

func TestNormalizationLookup_CanonicalizesRawTextAndReturnsShelfLife(t *testing.T) {
	srv, _ := newTestServer(t)
	resp := postJSON(t, srv.URL+"/normalization/lookup", `{"items":[" Tomatoes ","Scallions"]}`)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	var got struct {
		Items []ItemDetails `json:"items"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	if len(got.Items) != 2 {
		t.Fatalf("got %d items, want 2: %+v", len(got.Items), got.Items)
	}
	if got.Items[0].CanonicalItem != "tomato" || got.Items[0].ShelfLifeDays != 5 || got.Items[0].Aisle != "produce" {
		t.Errorf("tomatoes -> %+v", got.Items[0])
	}
	if got.Items[1].CanonicalItem != "green onion" || got.Items[1].ShelfLifeDays != 10 {
		t.Errorf("scallions -> %+v", got.Items[1])
	}
}

func TestNormalizationLookup_OmitsShelfLifeForUnknownItems(t *testing.T) {
	srv, _ := newTestServer(t)
	resp := postJSON(t, srv.URL+"/normalization/lookup", `{"items":["unobtainium"]}`)
	defer resp.Body.Close()
	var raw map[string][]map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		t.Fatal(err)
	}
	item := raw["items"][0]
	if _, present := item["shelfLifeDays"]; present {
		t.Fatalf("unknown item carried a shelf life: %+v — never guess", item)
	}
	if item["aisle"] != "other" {
		t.Fatalf("aisle = %v, want other", item["aisle"])
	}
}

func TestNormalizationLookup_CollapsesDuplicates(t *testing.T) {
	srv, _ := newTestServer(t)
	resp := postJSON(t, srv.URL+"/normalization/lookup", `{"items":["milk","Milk","whole milk"]}`)
	defer resp.Body.Close()
	var got struct {
		Items []ItemDetails `json:"items"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	if len(got.Items) != 1 {
		t.Fatalf("got %d items, want 1 deduped: %+v", len(got.Items), got.Items)
	}
}

func TestNormalizationCoverage_ReportsShareAndNamesTheMisses(t *testing.T) {
	srv, store := newTestServer(t)
	if _, err := store.CreateRecipe(context.Background(), "user-a", RecipeInput{Title: "Odd Bowl", Ingredients: []Ingredient{
		{Quantity: 1, Unit: "", Item: "tomato"},
		{Quantity: 1, Unit: "", Item: "unobtainium"},
		{Quantity: 2, Unit: "", Item: "unobtainium"}, // same miss twice: counted, listed once
	}}); err != nil {
		t.Fatalf("create: %v", err)
	}

	resp := doAuth(t, http.MethodGet, srv.URL+"/normalization/coverage", nil)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	var got CoverageReport
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	if got.Lines != 3 {
		t.Fatalf("lines = %d, want the 3 ingredient lines of the one stored recipe", got.Lines)
	}
	if got.Resolved != 1 || got.Share <= 0 || got.Share >= 1 {
		t.Fatalf("resolved/share = %d/%v, want 1 and a fraction", got.Resolved, got.Share)
	}
	if len(got.Unresolved) != 1 || got.Unresolved[0].Item != "unobtainium" || got.Unresolved[0].Count != 2 {
		t.Fatalf("unresolved = %+v, want unobtainium x2", got.Unresolved)
	}
	if len(got.Unresolved[0].Examples) != 1 || got.Unresolved[0].Examples[0] != "Odd Bowl" {
		t.Errorf("examples = %v, want the recipe title so an operator can go look", got.Unresolved[0].Examples)
	}
}

func TestNormalizationCoverage_RequiresAuth(t *testing.T) {
	srv, _ := newTestServer(t)
	resp, err := http.Get(srv.URL + "/normalization/coverage")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", resp.StatusCode)
	}
}
