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
	var ldMethods []string
	// Only JSON-LD supplies a yield today; the LLM fallback leaves it unknown.
	var servings *int
	// Discovery metadata, likewise JSON-LD only (BL-0020).
	var cuisine string
	var tags []string
	var totalMinutes *int

	if ld, ok := extractJSONLD(html); ok && len(ld.IngredientLines) > 0 {
		title = ld.Title
		servings = ld.Servings
		for _, line := range ld.IngredientLines {
			ings = append(ings, parseIngredientLine(line))
		}
		steps = ld.Steps
		ldMethods = ld.CookingMethods
		cuisine, tags, totalMinutes = ld.Cuisine, ld.Tags, ld.TotalMinutes
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

	// Deterministic equipment/method tagging (BL-0041): schema.org cookingMethod
	// mapped onto the closed enum, plus an alias scan over the step text. The
	// title is deliberately not scanned — "grilled cheese" is not a grill recipe.
	// An LLM tagger is BL-0044's job and is not wired here.
	equip, methods := equipmentCatalog.DetectTags(steps)
	methods = normMethods(append(equipmentCatalog.MethodsFromJSONLD(ldMethods), methods...))

	// Scraped metadata goes through the same validator as a hand-typed recipe,
	// so an imported "Gluten Free" lands on the same chip. Sites routinely
	// publish dozens of keywords, so the list is capped BEFORE validating —
	// otherwise a keyword-stuffed page would fail the whole metadata check and
	// lose its cuisine and cook time along with the surplus tags.
	tags = normTags(tags)
	if len(tags) > maxTags {
		tags = tags[:maxTags]
	}
	normCuisine, normalizedTags, sourceURL, err := ValidateDiscovery(cuisine, totalMinutes, tags, rawURL)
	if err != nil {
		// A page with an unusable value loses only that value: bad metadata must
		// never fail an import whose ingredients parsed fine. rawURL already
		// passed the fetcher's SSRF checks, so keep it as attribution regardless.
		normCuisine, normalizedTags, totalMinutes = "", nil, nil
		sourceURL, _ = normSourceURL(rawURL)
	}

	return Recipe{
		UserID:       userID,
		Title:        strings.TrimSpace(title),
		Servings:     servings,
		Ingredients:  ings,
		Steps:        steps,
		Equipment:    equip,
		Methods:      methods,
		Cuisine:      normCuisine,
		TotalMinutes: totalMinutes,
		Tags:         normTags(normalizedTags),
		// No SourceRecipeID: an import is not a clone of anything we own.
		SourceURL: sourceURL,
	}, nil
}
