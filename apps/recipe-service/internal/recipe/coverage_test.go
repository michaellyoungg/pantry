package recipe

import (
	"os"
	"strings"
	"testing"
)

// The two coverage floors below are the point of BL-0031. They are asserted, not
// merely printed, so a dictionary edit that regresses real-world resolution
// fails CI instead of quietly making the pantry stop matching.
//
// They are floors rather than exact values: adding entries should be free, and
// only a DROP is a regression. Raise them when coverage rises — that is the
// ratchet.
// The BL-0031 dictionary work moved these from their measured baseline of 0.93
// and 0.35. The three lines the corpus still misses are two that name TWO
// ingredients in one string ("salt and pepper to taste") and one stacked
// qualifier ("whole milk ricotta cheese") — a splitting problem and a parsing
// problem, neither of which a dictionary entry can honestly fix.
const (
	catalogCoverageFloor = 1.0
	importCoverageFloor  = 0.98
)

func TestCatalogCoverage(t *testing.T) {
	got, err := CatalogCoverage()
	if err != nil {
		t.Fatalf("CatalogCoverage: %v", err)
	}
	t.Logf("seeded catalog: %d/%d lines resolve (%.1f%%)", got.Resolved, got.Lines, got.Share*100)
	for _, u := range got.Unresolved {
		t.Logf("  unresolved x%d: %q (%s)", u.Count, u.Item, strings.Join(u.Examples, ", "))
	}
	if got.Lines == 0 {
		t.Fatal("catalog produced no ingredient lines")
	}
	if got.Share < catalogCoverageFloor {
		t.Errorf("catalog coverage = %.3f, want >= %.3f", got.Share, catalogCoverageFloor)
	}
}

func TestImportedLineCoverage(t *testing.T) {
	raw, err := os.ReadFile("testdata/imported-lines.txt")
	if err != nil {
		t.Fatalf("read corpus: %v", err)
	}
	got := CoverageOfLines(strings.Split(string(raw), "\n"))
	t.Logf("imported-line corpus: %d/%d lines resolve (%.1f%%)", got.Resolved, got.Lines, got.Share*100)
	for _, u := range got.Unresolved {
		t.Logf("  unresolved x%d: %q", u.Count, u.Item)
	}
	if got.Lines < 100 {
		t.Fatalf("corpus has %d lines, expected a corpus of at least 100", got.Lines)
	}
	if got.Share < importCoverageFloor {
		t.Errorf("imported-line coverage = %.3f, want >= %.3f", got.Share, importCoverageFloor)
	}
}

func TestCoverageCounterRanksMissesByFrequency(t *testing.T) {
	c := NewCoverageCounter()
	c.Add("garlic", "Garlic Bread")
	c.Add("moon cheese", "Lunar Toastie")
	c.Add("moon cheese", "Lunar Toastie") // same source: cited once
	c.Add("moon cheese", "Crater Melt")
	c.Add("stardust", "Crater Melt")
	c.Add("   ", "Blank Line") // ignored entirely, neither hit nor miss

	got := c.Report()
	if got.Lines != 5 || got.Resolved != 1 {
		t.Fatalf("lines/resolved = %d/%d, want 5/1", got.Lines, got.Resolved)
	}
	if got.Share != 0.2 {
		t.Errorf("share = %v, want 0.2", got.Share)
	}
	if len(got.Unresolved) != 2 {
		t.Fatalf("unresolved = %+v, want 2 entries", got.Unresolved)
	}
	if got.Unresolved[0].Item != "moon cheese" || got.Unresolved[0].Count != 3 {
		t.Errorf("first unresolved = %+v, want moon cheese x3", got.Unresolved[0])
	}
	if len(got.Unresolved[0].Examples) != 2 {
		t.Errorf("examples = %v, want the two distinct titles", got.Unresolved[0].Examples)
	}
	if got.Unresolved[1].Item != "stardust" {
		t.Errorf("second unresolved = %+v, want stardust", got.Unresolved[1])
	}
}

func TestCoverageOfLinesSkipsCommentsAndParsesQuantities(t *testing.T) {
	got := CoverageOfLines([]string{
		"# a comment, not an ingredient",
		"",
		"2 cloves garlic, minced",
		"1 cup unobtainium",
	})
	if got.Lines != 2 {
		t.Fatalf("lines = %d, want 2 (comment and blank ignored)", got.Lines)
	}
	if got.Resolved != 1 {
		t.Fatalf("resolved = %d, want 1", got.Resolved)
	}
	if len(got.Unresolved) != 1 || got.Unresolved[0].Item != "unobtainium" {
		t.Errorf("unresolved = %+v, want [unobtainium]", got.Unresolved)
	}
}

func TestCoverageOfEmptyCorpusIsZeroNotFullMarks(t *testing.T) {
	got := CoverageOfLines(nil)
	if got.Share != 0 {
		t.Errorf("share = %v, want 0 for an empty corpus", got.Share)
	}
	if got.Unresolved == nil {
		t.Error("Unresolved must be non-nil so it marshals as [] rather than null")
	}
}
