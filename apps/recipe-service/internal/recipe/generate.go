package recipe

import (
	"context"
	"log/slog"
	"sort"
	"strings"

	"pantry/apps/recipe-service/internal/recommend"
)

// The generated half of BL-0034.
//
// # What this is, and what it deliberately is not
//
// It is a CANDIDATE PROVIDER. A generated recipe is appended to the same pool
// the corpus fills, converted through the same canonicalization, and then ranked
// by the same RankPantry call as everything else. It is NOT a second ranker and
// it is NOT a bypass.
//
// That one sentence is the whole safety argument. The avoid list is a hard
// pre-filter inside RankPantry (see recommend.containsAvoided), matching both a
// canonical item and its allergen families (BL-0052). Because a generated
// candidate arrives as an ordinary recommend.Candidate — with its ingredients
// canonicalized by the SAME normalizer.Details call the corpus uses — a model
// that cheerfully invents a peanut sauce for someone who avoids peanuts has its
// recipe dropped by the filter, exactly like a catalog recipe would be. Prompt
// compliance is a nice-to-have here, never the mechanism. See
// TestRecommendPantryGeneratedCandidateCannotBypassAvoidList.
//
// # Cost
//
// Generation is off the hot path. It runs only when the corpus produced fewer
// than generationThinThreshold results — the cold-start case the item exists for
// — and only when the pantry has something to generate FROM. It asks for at most
// maxGeneratedRecipes ideas and drops anything past that if the model overshoots.
//
// # Storage
//
// Nothing generated is stored here. Drafts ride back on the response so a client
// can turn one into a real recipe IF the user accepts it; the ones nobody
// accepts are simply forgotten when the request ends.

const (
	// generationThinThreshold is how few corpus results count as "thin".
	//
	// The number is small on purpose. Curated recipes beat invented ones, so
	// generation is a floor under an empty screen, not a way to pad a page that
	// already has real suggestions on it.
	generationThinThreshold = 3

	// maxGeneratedRecipes bounds one generation call. Five is enough to fill an
	// empty card and small enough that a single request cannot become expensive.
	maxGeneratedRecipes = 5

	// maxBriefItems bounds how much pantry we describe to the model. A very
	// large pantry would otherwise grow the prompt without improving the
	// answer — beyond a few dozen ingredients the constraint stops binding.
	maxBriefItems = 40

	// generatedIDPrefix marks an id that names nothing in the database.
	//
	// Clients must never treat it as a recipe id: GET /recipes/{that} is a 404,
	// by construction, because the recipe does not exist until someone accepts
	// it. The prefix is what makes the difference visible in a log line.
	generatedIDPrefix = "gen-"

	// SourceGenerated is the recommend.Result source for an invented recipe. It
	// is the field the UI labels from — see the item: presenting a generated
	// suggestion as a curated one is dishonest.
	SourceGenerated = "generated"
)

// GeneratedRecipe is a recipe idea the model invented for one request.
//
// It is a DRAFT: no row exists for it, and its ID is a synthetic gen- id that
// resolves to nothing. It is returned alongside the ranked results purely so a
// client that has just shown the user a generated suggestion can persist it
// verbatim when they accept it, instead of asking the model for it a second time
// and getting something slightly different.
type GeneratedRecipe struct {
	// RecipeID matches the recommend.Result this draft belongs to, which is how
	// a client joins the two.
	RecipeID    string       `json:"recipeId"`
	Title       string       `json:"title"`
	Servings    *int         `json:"servings,omitempty"`
	Ingredients []Ingredient `json:"ingredients"`
	Steps       []string     `json:"steps"`
}

// GenerationBrief is everything the generator is told about the user. It is
// canonicalized vocabulary, not raw text: the same keys the ranker scores on.
type GenerationBrief struct {
	// Have is what the user has on hand, most useful first.
	Have []string
	// UseItUp is the subset flagged to use up, listed separately because it is
	// the strongest signal on this surface.
	UseItUp []string
	// Avoid is the hard-filter vocabulary. It is sent so the model does not
	// waste a slot on a recipe that will be dropped — NOT as the enforcement.
	Avoid []string
	// Liked and Disliked are soft preference signals.
	Liked    []string
	Disliked []string
	// Count is how many ideas to return, already bounded by the caller.
	Count int
}

// Generator invents recipe ideas from a brief.
//
// Implementations are network calls and may fail. Every caller treats failure as
// "no candidates", never as a request error: with no generator configured, or a
// generator that errors, this endpoint must behave EXACTLY as it did before this
// feature existed.
type Generator interface {
	Generate(ctx context.Context, brief GenerationBrief) ([]GeneratedRecipe, error)
}

// WithGenerator enables generated candidates on POST /recommendations/pantry.
// Without it — which is the default, and the only configuration that runs
// without an ANTHROPIC_API_KEY — the endpoint is corpus-only.
func WithGenerator(g Generator) RouterOption {
	return func(h *handlers) { h.generator = g }
}

// shouldGenerate gates generation on the two things that make it worth paying
// for: a configured generator, and a corpus that came up short.
func (h *handlers) shouldGenerate(results []recommend.Result) bool {
	return h.generator != nil && len(results) < generationThinThreshold
}

// generateDrafts asks the generator for ideas and returns what it produced.
//
// It returns an empty slice for every failure mode — no generator, an empty
// pantry, a transport error, a model that answered with nothing. Silent
// degradation is the specified behaviour, so the only trace of a failure is a
// log line.
func (h *handlers) generateDrafts(ctx context.Context, uc recommend.UserContext) []GeneratedRecipe {
	brief, ok := briefFrom(uc)
	if !ok {
		return nil
	}
	drafts, err := h.generator.Generate(ctx, brief)
	if err != nil {
		// Warn, not error: a recommendation page that lost its optional garnish
		// is not a broken request, and this path is expected to fail sometimes.
		slog.WarnContext(ctx, "recommendations: candidate generation failed", "err", err)
		return nil
	}
	return validGenerated(drafts)
}

// briefFrom reduces a UserContext to the brief. ok is false when there is
// nothing to generate from.
//
// An empty pantry is a deliberate no-go. This surface answers "what can I make
// with what I have"; with nothing on hand the question has no content, and
// asking a model to invent dinner from thin air spends money to produce a
// suggestion the user could have got from the catalog.
func briefFrom(uc recommend.UserContext) (GenerationBrief, bool) {
	var have, useItUp []string
	for _, item := range uc.Pantry {
		// "out" means the user does NOT have it. Generating a recipe around an
		// ingredient they have run out of is precisely backwards.
		if item.State == "out" || strings.TrimSpace(item.CanonicalItem) == "" {
			continue
		}
		if item.UseItUp {
			useItUp = append(useItUp, item.CanonicalItem)
			continue
		}
		have = append(have, item.CanonicalItem)
	}
	if len(have)+len(useItUp) == 0 {
		return GenerationBrief{}, false
	}

	// Sorted so one pantry always produces one prompt: an unstable prompt makes
	// the feature impossible to reason about in a log, and would defeat any
	// upstream caching.
	sort.Strings(have)
	sort.Strings(useItUp)

	// Use-it-up items are kept whole and `have` absorbs the cap, because the
	// flagged ones are the reason this card exists.
	if room := maxBriefItems - len(useItUp); len(have) > room {
		if room < 0 {
			room = 0
		}
		have = have[:room]
	}

	return GenerationBrief{
		Have:     have,
		UseItUp:  useItUp,
		Avoid:    append([]string(nil), uc.Preferences.AvoidItems...),
		Liked:    append([]string(nil), uc.Preferences.LikedItems...),
		Disliked: append([]string(nil), uc.Preferences.DislikedItems...),
		Count:    maxGeneratedRecipes,
	}, true
}

// validGenerated keeps the drafts that could actually be shown, assigns each a
// synthetic id, and enforces the count bound on the way through.
//
// A model that returns eight recipes when asked for five is not an error worth
// failing on, but it is not a reason to show eight either.
func validGenerated(drafts []GeneratedRecipe) []GeneratedRecipe {
	out := make([]GeneratedRecipe, 0, len(drafts))
	for _, d := range drafts {
		if len(out) == maxGeneratedRecipes {
			break
		}
		// A recipe with no title or no ingredients cannot be ranked (it would
		// match nothing) and cannot be saved. Drop it rather than show a blank.
		if strings.TrimSpace(d.Title) == "" || len(d.Ingredients) == 0 {
			continue
		}
		d.RecipeID = generatedIDPrefix + newID()
		d.Title = strings.TrimSpace(d.Title)
		if d.Steps == nil {
			d.Steps = []string{}
		}
		out = append(out, d)
	}
	return out
}

// asRecipe projects a draft into the Recipe shape the rest of this package
// speaks, so generated candidates go through EXACTLY the same conversion and
// nutrition estimation as stored ones. Nothing about the ranking pipeline gets
// to know the difference.
func (g GeneratedRecipe) asRecipe() Recipe {
	return Recipe{
		ID:          g.RecipeID,
		Title:       g.Title,
		Servings:    g.Servings,
		Ingredients: g.Ingredients,
		Steps:       g.Steps,
		Tags:        []string{},
		PrepTasks:   []StoredPrepTask{},
	}
}

// generatedRecipes projects a batch of drafts.
func generatedRecipes(drafts []GeneratedRecipe) []Recipe {
	out := make([]Recipe, 0, len(drafts))
	for _, d := range drafts {
		out = append(out, d.asRecipe())
	}
	return out
}

// draftsInResults keeps only the drafts that SURVIVED ranking.
//
// This is where the safety property becomes visible on the wire. A generated
// recipe the avoid filter dropped is absent from the results, so it is absent
// here too — the client is never handed a draft it could persist for a user who
// cannot eat it.
func draftsInResults(drafts []GeneratedRecipe, results []recommend.Result) []GeneratedRecipe {
	kept := make(map[string]bool, len(results))
	for _, r := range results {
		kept[r.RecipeID] = true
	}
	out := make([]GeneratedRecipe, 0, len(drafts))
	for _, d := range drafts {
		if kept[d.RecipeID] {
			out = append(out, d)
		}
	}
	return out
}
