package recipe

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestClaudeExtractor_ParsesStructuredOutput(t *testing.T) {
	var gotKey, gotPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotKey = r.Header.Get("x-api-key")
		gotPath = r.URL.Path
		_, _ = io.ReadAll(r.Body)
		resp := map[string]any{
			"stop_reason": "end_turn",
			"content": []map[string]any{{
				"type": "text",
				"text": `{"title":"Soup","ingredients":[{"quantity":2,"unit":"cup","item":"broth"}]}`,
			}},
		}
		w.Header().Set("content-type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}))
	defer srv.Close()

	c := NewClaudeExtractor("test-key")
	c.baseURL = srv.URL
	c.client = srv.Client()

	got, err := c.Extract(context.Background(), "some page text")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if gotKey != "test-key" {
		t.Errorf("x-api-key = %q, want test-key", gotKey)
	}
	if gotPath != "/v1/messages" {
		t.Errorf("path = %q, want /v1/messages", gotPath)
	}
	if got.Title != "Soup" || len(got.Ingredients) != 1 || got.Ingredients[0].Item != "broth" {
		t.Fatalf("unexpected extraction: %+v", got)
	}
}

func TestClaudeExtractor_Refusal(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, `{"stop_reason":"refusal","content":[]}`)
	}))
	defer srv.Close()
	c := NewClaudeExtractor("k")
	c.baseURL = srv.URL
	c.client = srv.Client()
	if _, err := c.Extract(context.Background(), "x"); err == nil || !strings.Contains(err.Error(), "refus") {
		t.Fatalf("err = %v, want a refusal error", err)
	}
}
