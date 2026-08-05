package recipe

import "testing"

// A curated entry has to be able to say where it came from. Without this the
// catalog is the one write path that structurally CANNOT carry attribution —
// import and manual entry both can — so a sourced recipe could never be seeded.
func TestParseCatalogKeepsAnEntrysSourceURL(t *testing.T) {
	recs, err := parseCatalog([]byte(`[{
		"id": "cat-x",
		"title": "Sourced",
		"ingredients": [{"quantity": 1, "unit": "cup", "item": "rice"}],
		"sourceUrl": "https://example.com/rice"
	}]`))
	if err != nil {
		t.Fatalf("parseCatalog: %v", err)
	}
	if recs[0].SourceURL != "https://example.com/rice" {
		t.Fatalf("sourceUrl = %q, want https://example.com/rice", recs[0].SourceURL)
	}
}

// The seed file goes through the same validator as a client request, so a
// broken link fails the boot rather than shipping a link nobody can follow.
func TestParseCatalogRejectsANonHTTPSourceURL(t *testing.T) {
	_, err := parseCatalog([]byte(`[{
		"id": "cat-x",
		"title": "Bad",
		"ingredients": [{"quantity": 1, "unit": "cup", "item": "rice"}],
		"sourceUrl": "javascript:alert(1)"
	}]`))
	if err == nil {
		t.Fatal("expected a javascript: sourceUrl to fail the catalog load")
	}
}

// Servings has to survive the parse, or the whole seed set feeds nobody and the
// planner's per-serving nutrition divides by nothing (BL-0035).
func TestParseCatalogKeepsAnEntrysServings(t *testing.T) {
	recs, err := parseCatalog([]byte(`[{
		"id": "cat-x",
		"title": "Feeds four",
		"servings": 4,
		"ingredients": [{"quantity": 1, "unit": "cup", "item": "rice"}]
	}]`))
	if err != nil {
		t.Fatalf("parseCatalog: %v", err)
	}
	if recs[0].Servings == nil || *recs[0].Servings != 4 {
		t.Fatalf("servings = %v, want 4", recs[0].Servings)
	}
}

// Nil is not zero, and it is not a default either: an entry that states no yield
// parses with none rather than being invented one (BL-0035).
func TestParseCatalogLeavesAnUnstatedServingsNil(t *testing.T) {
	recs, err := parseCatalog([]byte(`[{
		"id": "cat-x",
		"title": "No yield",
		"ingredients": [{"quantity": 1, "unit": "cup", "item": "rice"}]
	}]`))
	if err != nil {
		t.Fatalf("parseCatalog: %v", err)
	}
	if recs[0].Servings != nil {
		t.Fatalf("servings = %v, want nil", *recs[0].Servings)
	}
}

// A recipe that feeds zero people is a typo, and it would make every
// per-serving figure a division by zero. Fail the boot instead.
func TestParseCatalogRejectsNonPositiveServings(t *testing.T) {
	if _, err := parseCatalog([]byte(`[{
		"id": "cat-x",
		"title": "Feeds nobody",
		"servings": 0,
		"ingredients": [{"quantity": 1, "unit": "cup", "item": "rice"}]
	}]`)); err == nil {
		t.Fatal("expected servings of 0 to fail the catalog load")
	}
}

// Most curated entries are hand-written and have no source. Absent must stay
// absent — an empty string, never an invented link.
func TestParseCatalogLeavesAnUnsourcedEntryEmpty(t *testing.T) {
	recs, err := parseCatalog([]byte(`[{
		"id": "cat-x",
		"title": "Unsourced",
		"ingredients": [{"quantity": 1, "unit": "cup", "item": "rice"}]
	}]`))
	if err != nil {
		t.Fatalf("parseCatalog: %v", err)
	}
	if recs[0].SourceURL != "" {
		t.Fatalf("sourceUrl = %q, want empty", recs[0].SourceURL)
	}
}
