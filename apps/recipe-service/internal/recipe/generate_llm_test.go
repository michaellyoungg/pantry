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

// stubClaude serves one canned Messages response and captures the request body.
func stubClaude(t *testing.T, text string) (*claudeGenerator, func() map[string]any) {
	t.Helper()
	var body map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &body)
		w.Header().Set("content-type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"stop_reason": "end_turn",
			"content":     []map[string]any{{"type": "text", "text": text}},
		})
	}))
	t.Cleanup(srv.Close)

	g := NewClaudeGenerator("test-key")
	g.c.baseURL = srv.URL
	g.c.client = srv.Client()
	return g, func() map[string]any { return body }
}

func TestClaudeGeneratorParsesRecipes(t *testing.T) {
	g, sent := stubClaude(t, `{"recipes":[
		{"title":"Garlic Fried Rice","servings":2,
		 "ingredients":[{"quantity":1,"unit":"cup","item":"rice"},{"quantity":2,"unit":"cloves","item":"garlic","note":"minced"}],
		 "steps":["Cook the rice.","Fry it with the garlic."]}
	]}`)

	got, err := g.Generate(context.Background(), GenerationBrief{
		Have: []string{"rice", "garlic"}, Count: 5,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("got %d recipes, want 1", len(got))
	}
	r := got[0]
	if r.Title != "Garlic Fried Rice" {
		t.Errorf("title = %q", r.Title)
	}
	if r.Servings == nil || *r.Servings != 2 {
		t.Errorf("servings = %v, want 2", r.Servings)
	}
	if len(r.Ingredients) != 2 || r.Ingredients[1].Note != "minced" {
		t.Errorf("ingredients = %+v", r.Ingredients)
	}
	if len(r.Steps) != 2 {
		t.Errorf("steps = %v", r.Steps)
	}

	// The client, not the caller, is what puts the brief on the wire.
	body := sent()
	if body["model"] == nil {
		t.Fatal("no model in the request body")
	}
	user, _ := body["messages"].([]any)
	if len(user) != 1 {
		t.Fatalf("messages = %v", body["messages"])
	}
	content, _ := user[0].(map[string]any)["content"].(string)
	if !strings.Contains(content, "rice") || !strings.Contains(content, "garlic") {
		t.Errorf("prompt did not carry the pantry: %q", content)
	}
}

// A zero or negative yield is "unknown" (BL-0035), never a real serving count.
// Passing it through would make every per-serving figure divide by it.
func TestClaudeGeneratorTreatsNonPositiveServingsAsUnknown(t *testing.T) {
	g, _ := stubClaude(t, `{"recipes":[
		{"title":"Soup","servings":0,"ingredients":[{"quantity":1,"unit":"cup","item":"broth"}],"steps":[]}
	]}`)

	got, err := g.Generate(context.Background(), GenerationBrief{Have: []string{"broth"}, Count: 1})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 1 || got[0].Servings != nil {
		t.Fatalf("servings = %v, want nil for a non-positive yield", got[0].Servings)
	}
}

func TestClaudeGeneratorRejectsNonJSONOutput(t *testing.T) {
	g, _ := stubClaude(t, "here are some ideas!")
	if _, err := g.Generate(context.Background(), GenerationBrief{Have: []string{"rice"}, Count: 1}); err == nil {
		t.Fatal("want an error for output that is not JSON")
	}
}

// The avoid list is stated to the model so it does not waste a slot — even
// though the ranker enforces it regardless.
func TestGenerateUserPromptCarriesTheAvoidList(t *testing.T) {
	prompt := generateUserPrompt(GenerationBrief{
		Have:    []string{"rice"},
		UseItUp: []string{"spinach"},
		Avoid:   []string{"peanut"},
		Count:   3,
	})
	for _, want := range []string{"rice", "spinach", "peanut", "USE UP SOON", "NEVER USE"} {
		if !strings.Contains(prompt, want) {
			t.Errorf("prompt missing %q:\n%s", want, prompt)
		}
	}
}

// An empty section is omitted entirely: a bare "LIKES" heading reads to the
// model as "this user likes nothing", which is not what absence means.
func TestGenerateUserPromptOmitsEmptySections(t *testing.T) {
	prompt := generateUserPrompt(GenerationBrief{Have: []string{"rice"}, Count: 1})
	for _, unwanted := range []string{"LIKES", "DISLIKES", "NEVER USE", "USE UP SOON"} {
		if strings.Contains(prompt, unwanted) {
			t.Errorf("prompt should omit the empty %q section:\n%s", unwanted, prompt)
		}
	}
}
