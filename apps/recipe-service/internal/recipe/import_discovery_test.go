package recipe

import (
	"context"
	"strings"
	"testing"
)

// pageWithDiscovery carries the metadata a real recipe site publishes: a
// cuisine, a total time, a category and a comma-separated keyword list.
const pageWithDiscovery = `<html><head>
<script type="application/ld+json">
{"@type":"Recipe","name":"Pad Thai",
 "recipeIngredient":["8 oz rice noodles","2 tbsp fish sauce"],
 "recipeInstructions":["Soak the noodles.","Toss in the wok."],
 "recipeCuisine":"Thai","totalTime":"PT35M",
 "recipeCategory":"Main Course","keywords":"weeknight, gluten free, one pot"}
</script></head><body></body></html>`

func TestImportCarriesDiscoveryMetadata(t *testing.T) {
	imp := NewImporter(fakeFetcher{body: []byte(pageWithDiscovery)}, nil)
	rec, err := imp.Import(context.Background(), "u1", "https://example.com/pad-thai")
	if err != nil {
		t.Fatalf("import: %v", err)
	}

	if rec.Cuisine != "thai" {
		t.Errorf("cuisine = %q, want thai", rec.Cuisine)
	}
	if rec.TotalMinutes == nil || *rec.TotalMinutes != 35 {
		t.Errorf("totalMinutes = %v, want 35", rec.TotalMinutes)
	}
	want := []string{"main-course", "weeknight", "gluten-free", "one-pot"}
	if strings.Join(rec.Tags, ",") != strings.Join(want, ",") {
		t.Errorf("tags = %v, want %v", rec.Tags, want)
	}
}

// Attribution + re-import: the URL the user pasted has to come back on the
// preview, or the review screen has nothing to credit and nothing to re-fetch.
func TestImportRecordsTheSourceURL(t *testing.T) {
	imp := NewImporter(fakeFetcher{body: []byte(pageWithDiscovery)}, nil)
	rec, err := imp.Import(context.Background(), "u1", "https://example.com/pad-thai")
	if err != nil {
		t.Fatalf("import: %v", err)
	}
	if rec.SourceURL != "https://example.com/pad-thai" {
		t.Errorf("sourceUrl = %q", rec.SourceURL)
	}
}

func TestImportSumsPrepAndCookWhenTotalTimeIsMissing(t *testing.T) {
	page := `<script type="application/ld+json">
	{"@type":"Recipe","name":"Stew","recipeIngredient":["1 lb beef"],
	 "prepTime":"PT15M","cookTime":"PT1H"}</script>`
	imp := NewImporter(fakeFetcher{body: []byte(page)}, nil)
	rec, err := imp.Import(context.Background(), "u1", "https://example.com/stew")
	if err != nil {
		t.Fatalf("import: %v", err)
	}
	if rec.TotalMinutes == nil || *rec.TotalMinutes != 75 {
		t.Errorf("totalMinutes = %v, want 75", rec.TotalMinutes)
	}
}

func TestImportLeavesCookTimeUnknownWhenThePageHasNone(t *testing.T) {
	imp := NewImporter(fakeFetcher{body: []byte(pageWithGraph)}, nil)
	rec, err := imp.Import(context.Background(), "u1", "https://example.com/r")
	if err != nil {
		t.Fatalf("import: %v", err)
	}
	if rec.TotalMinutes != nil {
		t.Errorf("totalMinutes = %d; a page with no time must stay unknown", *rec.TotalMinutes)
	}
	if rec.Tags == nil {
		t.Error("tags is nil; the wire contract is []")
	}
}

// Junk metadata must cost only the metadata. An import whose ingredients parsed
// is a successful import.
func TestImportSurvivesUnusableMetadata(t *testing.T) {
	page := `<script type="application/ld+json">
	{"@type":"Recipe","name":"Cake","recipeIngredient":["2 cups flour"],
	 "recipeCuisine":"` + strings.Repeat("x", maxTagLen+50) + `","totalTime":"tomorrow"}</script>`
	imp := NewImporter(fakeFetcher{body: []byte(page)}, nil)
	rec, err := imp.Import(context.Background(), "u1", "https://example.com/cake")
	if err != nil {
		t.Fatalf("bad metadata must not fail the import: %v", err)
	}
	if rec.Title != "Cake" || len(rec.Ingredients) != 1 {
		t.Fatalf("recipe body lost: %+v", rec)
	}
	if rec.Cuisine != "" {
		t.Errorf("cuisine = %q, want it dropped", rec.Cuisine)
	}
	if rec.SourceURL != "https://example.com/cake" {
		t.Errorf("sourceUrl = %q; attribution must survive bad metadata", rec.SourceURL)
	}
}

// A keyword-stuffed page must not cost the fields we could actually use.
func TestImportCapsKeywordStuffingWithoutLosingCuisine(t *testing.T) {
	keywords := make([]string, 0, maxTags*2)
	for i := 0; i < maxTags*2; i++ {
		keywords = append(keywords, "tag"+string(rune('a'+i%26))+strings.Repeat("z", i%5))
	}
	page := `<script type="application/ld+json">
	{"@type":"Recipe","name":"Stuffed","recipeIngredient":["1 thing"],
	 "recipeCuisine":"Greek","totalTime":"PT20M",
	 "keywords":"` + strings.Join(keywords, ", ") + `"}</script>`

	imp := NewImporter(fakeFetcher{body: []byte(page)}, nil)
	rec, err := imp.Import(context.Background(), "u1", "https://example.com/stuffed")
	if err != nil {
		t.Fatalf("import: %v", err)
	}
	if len(rec.Tags) > maxTags {
		t.Errorf("kept %d tags, want at most %d", len(rec.Tags), maxTags)
	}
	if rec.Cuisine != "greek" {
		t.Errorf("cuisine = %q; capping tags must not discard the other metadata", rec.Cuisine)
	}
	if rec.TotalMinutes == nil || *rec.TotalMinutes != 20 {
		t.Errorf("totalMinutes = %v, want 20", rec.TotalMinutes)
	}
}
