package recipe

import (
	"context"
	"errors"
	"testing"
)

type fakeFetcher struct {
	body []byte
	err  error
}

func (f fakeFetcher) Fetch(context.Context, string) ([]byte, error) { return f.body, f.err }

type fakeExtractor struct {
	rec ExtractedRecipe
	err error
}

func (f fakeExtractor) Extract(context.Context, string) (ExtractedRecipe, error) {
	return f.rec, f.err
}

func TestImporter_JSONLDPath(t *testing.T) {
	imp := NewImporter(fakeFetcher{body: []byte(pageWithGraph)}, nil)
	rec, err := imp.Import(context.Background(), "u1", "https://example.com/r")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if rec.UserID != "u1" || rec.Title != "Garlic Bread" || len(rec.Ingredients) != 2 {
		t.Fatalf("unexpected recipe: %+v", rec)
	}
	if rec.Ingredients[0] != (Ingredient{Quantity: 2, Unit: "clove", Item: "garlic", Note: "minced"}) {
		t.Fatalf("first ingredient not parsed: %+v", rec.Ingredients[0])
	}
	if len(rec.Steps) != 2 || rec.Steps[0] != "Mince the garlic." || rec.Steps[1] != "Toast the bread." {
		t.Fatalf("extracted steps not carried through import: %+v", rec.Steps)
	}
	if rec.ID != "" {
		t.Errorf("preview must not carry an id, got %q", rec.ID)
	}
}

func TestImporter_LLMFallback(t *testing.T) {
	ex := fakeExtractor{rec: ExtractedRecipe{
		Title:       "Soup",
		Ingredients: []Ingredient{{Quantity: 1, Unit: "cup", Item: "broth"}},
		Steps:       []string{"Simmer the broth."},
	}}
	imp := NewImporter(fakeFetcher{body: []byte("<html>no json-ld here</html>")}, ex)
	rec, err := imp.Import(context.Background(), "u1", "https://example.com/r")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if rec.Title != "Soup" || len(rec.Ingredients) != 1 {
		t.Fatalf("unexpected recipe: %+v", rec)
	}
	if len(rec.Steps) != 1 || rec.Steps[0] != "Simmer the broth." {
		t.Fatalf("LLM steps not carried through import: %+v", rec.Steps)
	}
}

func TestImporter_NoJSONLDNoExtractor(t *testing.T) {
	imp := NewImporter(fakeFetcher{body: []byte("<html>nothing</html>")}, nil)
	_, err := imp.Import(context.Background(), "u1", "https://example.com/r")
	if !errors.Is(err, ErrImportUnparseable) {
		t.Fatalf("err = %v, want ErrImportUnparseable", err)
	}
}

func TestImporter_FetchErrorPropagates(t *testing.T) {
	imp := NewImporter(fakeFetcher{err: ErrImportFetch}, nil)
	_, err := imp.Import(context.Background(), "u1", "https://example.com/r")
	if !errors.Is(err, ErrImportFetch) {
		t.Fatalf("err = %v, want ErrImportFetch", err)
	}
}

func TestHTMLToText_StripsTagsAndScripts(t *testing.T) {
	got := htmlToText([]byte(`<html><head><style>x{}</style></head><body><script>bad()</script><p>Hello  world</p></body></html>`))
	if got != "Hello world" {
		t.Fatalf("htmlToText = %q, want %q", got, "Hello world")
	}
}
