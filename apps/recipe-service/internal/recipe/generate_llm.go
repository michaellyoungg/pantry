package recipe

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// The model-backed Generator (BL-0034).
//
// It shares the Claude client the import fallback and the tagging fallback use,
// for the same reason NewClaudeTagger does: all three are gated on the single
// ANTHROPIC_API_KEY, and separate configuration would let them disagree about
// which model runs.
//
// Note what the prompt does and does not carry. It states the avoid list, so the
// model does not waste a slot on a recipe that is going to be discarded. It is
// NOT how the avoid list is enforced — that is a hard filter in the ranker, and
// it runs whether or not the model paid attention. See generate.go.

// generateTimeout bounds one generation call.
//
// Generation happens inside a recommendation request, so this is time the user
// waits. It only ever elapses on the cold-start path, where the alternative on
// screen is an empty card, and the caller's own client timeout is set above it
// (see packages/convex/convex/recommendations.ts) so a slow model surfaces as a
// slower card rather than as a failed one.
const generateTimeout = 15 * time.Second

const generateSystemPrompt = `You invent simple, realistic home recipes from the ingredients someone
already has.

You are given a pantry, an avoid list, and taste preferences. Return recipe ideas that lean on the
pantry — especially anything listed as "use up soon" — and that a home cook could make on a weeknight.

Rules:
- Build around the pantry. A recipe that needs a dozen things the user does not have is not useful.
- Never use an ingredient on the avoid list, in any form. These are allergies and hard dislikes.
- Ingredient items must be plain, singular ingredient names ("chicken thigh", "soy sauce"), with the
  amount in quantity and unit. Put preparation ("finely chopped") in the note, never in the item.
- Give a realistic servings count and ordered, specific steps.
- Do not invent brand names, and do not claim a recipe is traditional or tested.
- Returning fewer recipes than asked for is a normal answer. Returning none is better than returning
  something you would not eat.`

// generatedRecipesJSONSchema constrains the model's output. It mirrors the
// import extractor's ingredient shape so both paths produce the same Ingredient.
var generatedRecipesJSONSchema = map[string]any{
	"type":                 "object",
	"additionalProperties": false,
	"required":             []string{"recipes"},
	"properties": map[string]any{
		"recipes": map[string]any{
			"type": "array",
			"items": map[string]any{
				"type":                 "object",
				"additionalProperties": false,
				"required":             []string{"title", "servings", "ingredients", "steps"},
				"properties": map[string]any{
					"title":    map[string]any{"type": "string"},
					"servings": map[string]any{"type": "integer"},
					"ingredients": map[string]any{
						"type": "array",
						"items": map[string]any{
							"type":                 "object",
							"additionalProperties": false,
							"required":             []string{"quantity", "unit", "item"},
							"properties": map[string]any{
								"quantity": map[string]any{"type": "number"},
								"unit":     map[string]any{"type": "string"},
								"item":     map[string]any{"type": "string"},
								"note":     map[string]any{"type": "string"},
							},
						},
					},
					"steps": map[string]any{
						"type":  "array",
						"items": map[string]any{"type": "string"},
					},
				},
			},
		},
	},
}

// claudeGenerator is the Generator backed by the shared Claude client.
type claudeGenerator struct{ c *claudeExtractor }

// NewClaudeGenerator builds the LLM candidate provider. Configure it only when
// an API key exists; without one the recommender must stay corpus-only.
func NewClaudeGenerator(apiKey string) *claudeGenerator {
	g := &claudeGenerator{c: NewClaudeExtractor(apiKey)}
	g.c.client = &http.Client{Timeout: generateTimeout}
	return g
}

func (g *claudeGenerator) Generate(ctx context.Context, brief GenerationBrief) ([]GeneratedRecipe, error) {
	ctx, cancel := context.WithTimeout(ctx, generateTimeout)
	defer cancel()

	text, err := g.c.complete(ctx, generateSystemPrompt, generateUserPrompt(brief), generatedRecipesJSONSchema, 4096)
	if err != nil {
		return nil, err
	}
	var parsed struct {
		Recipes []struct {
			Title       string       `json:"title"`
			Servings    *int         `json:"servings"`
			Ingredients []Ingredient `json:"ingredients"`
			Steps       []string     `json:"steps"`
		} `json:"recipes"`
	}
	if err := json.Unmarshal([]byte(text), &parsed); err != nil {
		return nil, fmt.Errorf("claude generation output was not valid JSON: %w", err)
	}

	out := make([]GeneratedRecipe, 0, len(parsed.Recipes))
	for _, r := range parsed.Recipes {
		// A non-positive yield is "unknown", not zero — the BL-0035 contract.
		// Passing 0 through would make every per-serving figure divide by it.
		servings := r.Servings
		if servings != nil && *servings <= 0 {
			servings = nil
		}
		out = append(out, GeneratedRecipe{
			Title:       r.Title,
			Servings:    servings,
			Ingredients: r.Ingredients,
			Steps:       r.Steps,
		})
	}
	return out, nil
}

// generateUserPrompt renders the brief. Every list is canonical vocabulary from
// the normalization dictionary, which is also what the ranker scores on, so the
// model is asked about the same ingredients the filter will judge it by.
func generateUserPrompt(brief GenerationBrief) string {
	var b strings.Builder
	fmt.Fprintf(&b, "Suggest up to %d recipes.\n", brief.Count)
	writeBriefList(&b, "USE UP SOON (prioritize these)", brief.UseItUp)
	writeBriefList(&b, "PANTRY", brief.Have)
	writeBriefList(&b, "NEVER USE (allergies and hard avoids)", brief.Avoid)
	writeBriefList(&b, "LIKES", brief.Liked)
	writeBriefList(&b, "DISLIKES", brief.Disliked)
	return b.String()
}

// writeBriefList omits an empty section entirely. An empty heading reads to the
// model as "the user likes nothing", which is not what absence means.
func writeBriefList(b *strings.Builder, heading string, items []string) {
	if len(items) == 0 {
		return
	}
	fmt.Fprintf(b, "\n%s\n", heading)
	for _, item := range items {
		fmt.Fprintf(b, "- %s\n", item)
	}
}
