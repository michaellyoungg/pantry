package recipe

import (
	"sort"
	"strings"
)

// Dictionary coverage — how much of the ingredient text we actually see resolves
// to a canonical item (BL-0031).
//
// Every downstream feature joins on `canonicalItem`: the pantry keys its rows on
// it, don't-rebuy matches through it, recommendations compute coverage through
// it, and nutrition resolves grams through it. An unresolved ingredient is not a
// cosmetic gap — it silently cannot match anything, and the feature above it
// looks broken when the real problem is a missing dictionary entry.
//
// So the dictionary needs a number, and the number has to be measured against
// text the app actually handles rather than an ideal vocabulary. That is what
// this file is: the metric ("share of ingredient lines that resolve") plus the
// list of what failed, which is the input to the next dictionary edit.

// maxCoverageExamples caps how many recipe titles an unresolved item cites. The
// list exists to make a miss findable, not to reproduce the corpus.
const maxCoverageExamples = 3

// UnresolvedIngredient is one piece of ingredient text the dictionary did not
// recognize, with how often it appeared and where.
type UnresolvedIngredient struct {
	// Item is the text as the normalizer saw it, lowercased and trimmed — the
	// key a dictionary entry would have to match.
	Item  string `json:"item"`
	Count int    `json:"count"`
	// Examples names up to maxCoverageExamples sources (recipe titles) so an
	// operator can go look at the line that produced it.
	Examples []string `json:"examples"`
}

// CoverageReport is the dictionary's report card over some body of ingredient
// text.
type CoverageReport struct {
	Lines    int `json:"lines"`
	Resolved int `json:"resolved"`
	// Share is Resolved/Lines in [0,1], and 0 for an empty corpus — nothing
	// measured is not full marks.
	Share float64 `json:"share"`
	// Unresolved is ordered by count descending, then item ascending, so the
	// most valuable dictionary entry to write next is always first and the
	// output is stable enough to diff between runs.
	Unresolved []UnresolvedIngredient `json:"unresolved"`
}

// CoverageCounter accumulates a CoverageReport one ingredient at a time. It
// exists so a caller can walk recipes it is already streaming (the HTTP
// endpoint) without first materializing every line.
//
// The zero value is not usable; call NewCoverageCounter.
type CoverageCounter struct {
	n          *Normalizer
	lines      int
	resolved   int
	unresolved map[string]*UnresolvedIngredient
}

func NewCoverageCounter() *CoverageCounter {
	return &CoverageCounter{n: normalizer, unresolved: map[string]*UnresolvedIngredient{}}
}

// Add records one ingredient line. source names where it came from (a recipe
// title) and may be empty.
//
// Blank item text is skipped entirely rather than counted as a miss: an empty
// line is a data-entry artifact, and letting it drag the metric down would make
// the dictionary look worse than it is.
func (c *CoverageCounter) Add(item, source string) {
	if strings.TrimSpace(item) == "" {
		return
	}
	c.lines++
	d := c.n.Details(item)
	if d.Known {
		c.resolved++
		return
	}
	u, ok := c.unresolved[d.CanonicalItem]
	if !ok {
		u = &UnresolvedIngredient{Item: d.CanonicalItem, Examples: []string{}}
		c.unresolved[d.CanonicalItem] = u
	}
	u.Count++
	if source != "" && len(u.Examples) < maxCoverageExamples && !contains(u.Examples, source) {
		u.Examples = append(u.Examples, source)
	}
}

// AddRecipe records every ingredient of a recipe, attributing misses to its title.
func (c *CoverageCounter) AddRecipe(rec Recipe) {
	for _, ing := range rec.Ingredients {
		c.Add(ing.Item, rec.Title)
	}
}

// Report renders the accumulated counts. Slices are always non-nil so the JSON
// carries `[]` rather than `null` — the same wire contract the rest of the
// service holds to.
func (c *CoverageCounter) Report() CoverageReport {
	out := CoverageReport{Lines: c.lines, Resolved: c.resolved, Unresolved: []UnresolvedIngredient{}}
	if c.lines > 0 {
		out.Share = float64(c.resolved) / float64(c.lines)
	}
	for _, u := range c.unresolved {
		out.Unresolved = append(out.Unresolved, *u)
	}
	sort.Slice(out.Unresolved, func(i, j int) bool {
		if out.Unresolved[i].Count != out.Unresolved[j].Count {
			return out.Unresolved[i].Count > out.Unresolved[j].Count
		}
		return out.Unresolved[i].Item < out.Unresolved[j].Item
	})
	return out
}

// CoverageOfLines measures raw ingredient LINES — "1/4 cup chopped fresh
// cilantro", the shape an import delivers — rather than tidy item names. It runs
// each line through the same parser an import does, so the number reflects the
// whole path from scraped text to canonical item and not just a dictionary
// lookup in isolation.
//
// Blank lines and lines starting with '#' are ignored, so a corpus file can
// carry its own provenance.
func CoverageOfLines(lines []string) CoverageReport {
	c := NewCoverageCounter()
	for _, line := range lines {
		t := strings.TrimSpace(line)
		if t == "" || strings.HasPrefix(t, "#") {
			continue
		}
		c.Add(parseIngredientLine(t).Item, "")
	}
	return c.Report()
}

// CoverageOfRecipes measures already-stored recipes, whose ingredients are
// structured and so need no parsing.
func CoverageOfRecipes(recipes []Recipe) CoverageReport {
	c := NewCoverageCounter()
	for _, rec := range recipes {
		c.AddRecipe(rec)
	}
	return c.Report()
}

// CatalogCoverage measures the seeded catalog, the one corpus that ships with
// the service and is identical in every environment.
func CatalogCoverage() (CoverageReport, error) {
	recs, err := LoadCatalog()
	if err != nil {
		return CoverageReport{}, err
	}
	return CoverageOfRecipes(recs), nil
}

func contains(xs []string, s string) bool {
	for _, x := range xs {
		if x == s {
			return true
		}
	}
	return false
}
