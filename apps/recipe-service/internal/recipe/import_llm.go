package recipe

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
)

const claudeModel = "claude-haiku-4-5"

const extractSystemPrompt = `You extract structured recipe data from the text of a web page.
Return the recipe's title, its ingredient list, and its ordered preparation steps. For each
ingredient, split it into a numeric quantity, a unit (empty string if none), the core item name,
and an optional note (e.g. "minced", "at room temperature"). If a value is absent, use 0 for
quantity and "" for unit. For steps, return each instruction as one string in order; use an empty
list if the page has no method. Do not invent ingredients or steps that are not present in the text.`

// recipeJSONSchema constrains the model's output (Anthropic structured outputs).
var recipeJSONSchema = map[string]any{
	"type":                 "object",
	"additionalProperties": false,
	"required":             []string{"title", "ingredients", "steps"},
	"properties": map[string]any{
		"title": map[string]any{"type": "string"},
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
}

type ExtractedRecipe struct {
	Title       string
	Ingredients []Ingredient
	Steps       []string
}

// Extractor turns cleaned page text into a structured recipe (LLM fallback).
type Extractor interface {
	Extract(ctx context.Context, pageText string) (ExtractedRecipe, error)
}

type claudeExtractor struct {
	apiKey  string
	model   string
	baseURL string
	client  *http.Client
}

// NewClaudeExtractor builds an Extractor backed by the Claude Messages API.
// Uses stdlib net/http to honor the service's no-new-dependency constraint.
func NewClaudeExtractor(apiKey string) *claudeExtractor {
	return &claudeExtractor{
		apiKey:  apiKey,
		model:   claudeModel,
		baseURL: "https://api.anthropic.com",
		client:  &http.Client{Timeout: 30 * time.Second},
	}
}

func (c *claudeExtractor) Extract(ctx context.Context, pageText string) (ExtractedRecipe, error) {
	text, err := c.complete(ctx, extractSystemPrompt, pageText, recipeJSONSchema, 4096)
	if err != nil {
		return ExtractedRecipe{}, err
	}
	var parsed struct {
		Title       string       `json:"title"`
		Ingredients []Ingredient `json:"ingredients"`
		Steps       []string     `json:"steps"`
	}
	if err := json.Unmarshal([]byte(text), &parsed); err != nil {
		return ExtractedRecipe{}, fmt.Errorf("claude output was not valid JSON: %w", err)
	}
	return ExtractedRecipe{Title: parsed.Title, Ingredients: parsed.Ingredients, Steps: parsed.Steps}, nil
}

// complete runs one schema-constrained Messages call and returns the model's
// JSON text. Shared by the two things this file asks the model to do — extract
// a recipe from a page, and tag one we already have — so there is a single
// place that knows the wire format, the headers, and what a refusal looks like.
func (c *claudeExtractor) complete(ctx context.Context, system, user string, schema map[string]any, maxTokens int) (string, error) {
	reqBody := map[string]any{
		"model":      c.model,
		"max_tokens": maxTokens,
		"system":     system,
		"messages":   []map[string]any{{"role": "user", "content": user}},
		"output_config": map[string]any{
			"format": map[string]any{"type": "json_schema", "schema": schema},
		},
	}
	buf, err := json.Marshal(reqBody)
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/v1/messages", bytes.NewReader(buf))
	if err != nil {
		return "", err
	}
	req.Header.Set("content-type", "application/json")
	req.Header.Set("x-api-key", c.apiKey)
	req.Header.Set("anthropic-version", "2023-06-01")

	resp, err := c.client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("claude: status %d", resp.StatusCode)
	}

	var apiResp struct {
		StopReason string `json:"stop_reason"`
		Content    []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&apiResp); err != nil {
		return "", err
	}
	if apiResp.StopReason == "refusal" {
		return "", errors.New("claude refused the request")
	}
	for _, block := range apiResp.Content {
		if block.Type == "text" {
			return block.Text, nil
		}
	}
	return "", errors.New("claude returned no text block")
}

// ── Tagging fallback (BL-0044) ──────────────────────────────────────────────
//
// Runs only when the deterministic keyword scan found no equipment and no
// methods. The model picks from closed vocabularies and from the shipped prep
// rule table; it never writes prep text. See prep_llm.go for why that boundary
// is where it is, and PrepTasksFromSuggestions for how it is enforced after the
// model has answered.

const tagSystemPrompt = `You tag a recipe that an automated keyword scan could not classify.

You are given the recipe and three closed vocabularies: cooking methods, equipment, and prep
rules. Choose only from them.

- equipment: the hardware the recipe actually requires. Mark required=false for anything the
  recipe offers as an alternative.
- methods: how the food is cooked.
- prep: which prep rules apply to this recipe, by id, each with the subject it applies to — the
  ingredient in its simplest singular form ("chicken breast"), or the method or equipment slug
  for rules keyed on those. Only include a rule when the recipe genuinely calls for that work.

Do NOT write prep instructions. The wording of every prep task comes from the rule you name.
Return empty lists rather than guessing; a recipe with nothing notable about it is a normal
answer.`

// claudeTagger is the Tagger backed by the same Claude client as extraction.
type claudeTagger struct{ c *claudeExtractor }

// NewClaudeTagger builds the LLM tagging fallback. It shares the extractor's
// client and model on purpose: both are gated on the one ANTHROPIC_API_KEY, and
// splitting the configuration would let them disagree about which model runs.
func NewClaudeTagger(apiKey string) *claudeTagger {
	return &claudeTagger{c: NewClaudeExtractor(apiKey)}
}

func (t *claudeTagger) Tag(ctx context.Context, title string, ingredients []Ingredient, steps []string) (RecipeTags, error) {
	text, err := t.c.complete(ctx, tagSystemPrompt, tagUserPrompt(title, ingredients, steps), tagJSONSchema(), 2048)
	if err != nil {
		return RecipeTags{}, err
	}
	var tags RecipeTags
	if err := json.Unmarshal([]byte(text), &tags); err != nil {
		return RecipeTags{}, fmt.Errorf("claude tagging output was not valid JSON: %w", err)
	}
	return tags, nil
}

// tagUserPrompt renders the recipe plus the vocabularies the model may choose
// from. The vocabularies come from the shipped catalogs and rule table rather
// than from a copy in the prompt, so adding a rule or a piece of equipment
// reaches the model with no further edit.
func tagUserPrompt(title string, ingredients []Ingredient, steps []string) string {
	var b strings.Builder
	fmt.Fprintf(&b, "RECIPE\n%s\n\nINGREDIENTS\n", title)
	for _, ing := range ingredients {
		fmt.Fprintf(&b, "- %s\n", strings.TrimSpace(strings.Join([]string{ing.Unit, ing.Item, ing.Note}, " ")))
	}
	b.WriteString("\nSTEPS\n")
	for i, s := range steps {
		fmt.Fprintf(&b, "%d. %s\n", i+1, s)
	}
	b.WriteString("\nEQUIPMENT VOCABULARY (slug — name)\n")
	for _, e := range EquipmentList() {
		fmt.Fprintf(&b, "- %s — %s\n", e.ID, e.Name)
	}
	b.WriteString("\nMETHOD VOCABULARY (slug — name)\n")
	for _, m := range equipmentCatalog.Methods() {
		fmt.Fprintf(&b, "- %s — %s\n", m.ID, m.Name)
	}
	b.WriteString("\nPREP RULES (id — the sentence it produces)\n")
	for _, rule := range PrepRuleCatalog() {
		fmt.Fprintf(&b, "- %s — %q [%s]\n", rule.ID, rule.Text, rule.Window)
	}
	return b.String()
}

// tagJSONSchema constrains the model to the three lists and nothing else. Note
// what it cannot express: there is no field anywhere for prep text.
func tagJSONSchema() map[string]any {
	return map[string]any{
		"type":                 "object",
		"additionalProperties": false,
		"required":             []string{"equipment", "methods", "prep"},
		"properties": map[string]any{
			"equipment": map[string]any{
				"type": "array",
				"items": map[string]any{
					"type":                 "object",
					"additionalProperties": false,
					"required":             []string{"id", "required"},
					"properties": map[string]any{
						"id":       map[string]any{"type": "string"},
						"required": map[string]any{"type": "boolean"},
					},
				},
			},
			"methods": map[string]any{
				"type":  "array",
				"items": map[string]any{"type": "string", "enum": cookingMethodIDs()},
			},
			"prep": map[string]any{
				"type": "array",
				"items": map[string]any{
					"type":                 "object",
					"additionalProperties": false,
					"required":             []string{"ruleId", "subject"},
					"properties": map[string]any{
						"ruleId":  map[string]any{"type": "string", "enum": prepRuleIDs()},
						"subject": map[string]any{"type": "string"},
					},
				},
			},
		},
	}
}

// cookingMethodIDs is the closed method enum as the schema's enum list.
func cookingMethodIDs() []string {
	methods := equipmentCatalog.Methods()
	ids := make([]string, len(methods))
	for i, m := range methods {
		ids[i] = m.ID
	}
	return ids
}

func prepRuleIDs() []string {
	rules := PrepRuleCatalog()
	ids := make([]string, len(rules))
	for i, r := range rules {
		ids[i] = r.ID
	}
	return ids
}
