package recipe

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestImportRecipe_JSONLD(t *testing.T) {
	imp := NewImporter(fakeFetcher{body: []byte(pageWithGraph)}, nil)
	srv := httptest.NewServer(NewRouterWithImporter(NewMemoryStore(), testSecret, imp))
	defer srv.Close()

	req := authReq(http.MethodPost, srv.URL+"/recipes/import",
		strings.NewReader(`{"url":"https://example.com/r"}`))
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	var got Recipe
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.Title != "Garlic Bread" || len(got.Ingredients) != 2 {
		t.Fatalf("unexpected preview: %+v", got)
	}
}

func TestImportRecipe_DisabledWhenNoImporter(t *testing.T) {
	// NewRouter (no importer) must report the feature unavailable, not panic.
	srv := httptest.NewServer(NewRouter(NewMemoryStore(), testSecret))
	defer srv.Close()
	req := authReq(http.MethodPost, srv.URL+"/recipes/import",
		strings.NewReader(`{"url":"https://example.com/r"}`))
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", resp.StatusCode)
	}
}

func TestImportRecipe_Unparseable(t *testing.T) {
	imp := NewImporter(fakeFetcher{body: []byte("<html>no recipe here</html>")}, nil)
	srv := httptest.NewServer(NewRouterWithImporter(NewMemoryStore(), testSecret, imp))
	defer srv.Close()
	req := authReq(http.MethodPost, srv.URL+"/recipes/import",
		strings.NewReader(`{"url":"https://example.com/r"}`))
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422", resp.StatusCode)
	}
}
