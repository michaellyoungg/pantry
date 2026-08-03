package recipe

import (
	"context"
	"fmt"
	"strings"
)

// Importer turns a recipe URL into a preview Recipe (never persisted).
type Importer struct {
	fetcher   Fetcher
	extractor Extractor // may be nil: LLM fallback disabled
}

func NewImporter(f Fetcher, e Extractor) *Importer {
	return &Importer{fetcher: f, extractor: e}
}

// Import fetches the URL, extracts a recipe (JSON-LD first, LLM fallback), and
// returns a preview Recipe scoped to userID. The returned recipe has no id and
// is not stored — the caller persists it later through the normal create path.
func (imp *Importer) Import(ctx context.Context, userID, rawURL string) (Recipe, error) {
	html, err := imp.fetcher.Fetch(ctx, rawURL)
	if err != nil {
		return Recipe{}, err // ErrImportBadURL or ErrImportFetch
	}

	var title string
	var ings []Ingredient
	var steps []string

	if ld, ok := extractJSONLD(html); ok && len(ld.IngredientLines) > 0 {
		title = ld.Title
		for _, line := range ld.IngredientLines {
			ings = append(ings, parseIngredientLine(line))
		}
		steps = ld.Steps
	} else if imp.extractor != nil {
		ex, err := imp.extractor.Extract(ctx, htmlToText(html))
		if err != nil {
			return Recipe{}, fmt.Errorf("%w: %v", ErrImportUnparseable, err)
		}
		title, ings, steps = ex.Title, ex.Ingredients, ex.Steps
	} else {
		return Recipe{}, ErrImportUnparseable
	}

	if strings.TrimSpace(title) == "" || len(ings) == 0 {
		return Recipe{}, ErrImportUnparseable
	}
	return Recipe{UserID: userID, Title: strings.TrimSpace(title), Ingredients: ings, Steps: steps}, nil
}
