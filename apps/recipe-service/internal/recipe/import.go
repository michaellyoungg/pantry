package recipe

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
)

// Importer turns a recipe URL into a preview Recipe (never persisted).
type Importer struct {
	fetcher   Fetcher
	extractor Extractor // may be nil: LLM fallback disabled
	tagger    Tagger    // may be nil: LLM tagging fallback disabled (BL-0044)
}

// ImporterOption configures optional import behaviour. Optional in the literal
// sense: everything here is gated on an API key that may not be configured, and
// the importer has to work without it.
type ImporterOption func(*Importer)

// WithTagger enables the model-derived equipment, method and prep tagging that
// runs only when the deterministic keyword scan finds nothing (BL-0044).
func WithTagger(t Tagger) ImporterOption {
	return func(imp *Importer) { imp.tagger = t }
}

func NewImporter(f Fetcher, e Extractor, opts ...ImporterOption) *Importer {
	imp := &Importer{fetcher: f, extractor: e}
	for _, opt := range opts {
		opt(imp)
	}
	return imp
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

	rec := Recipe{
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
		PrepTasks: []StoredPrepTask{},
	}
	imp.tagFallback(ctx, &rec)
	return rec, nil
}

// tagFallback asks the model to tag a recipe the keyword scan could not
// (BL-0044), and only then: a scan hit is deterministic, free, and improvable
// for every recipe at once, so it always wins.
//
// Failure is not an import failure. The user asked for their recipe, and
// handing them an error because an optional enrichment call timed out would
// trade the thing they wanted for the thing they did not ask for.
func (imp *Importer) tagFallback(ctx context.Context, rec *Recipe) {
	if imp.tagger == nil || len(rec.Equipment) > 0 || len(rec.Methods) > 0 {
		return
	}
	tags, err := imp.tagger.Tag(ctx, rec.Title, rec.Ingredients, rec.Steps)
	if err != nil {
		slog.WarnContext(ctx, "import: llm tagging failed, keeping the untagged recipe", "error", err)
		return
	}
	applyTags(ctx, rec, tags)
}
