package recipe

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
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
	reqBody := map[string]any{
		"model":      c.model,
		"max_tokens": 4096,
		"system":     extractSystemPrompt,
		"messages":   []map[string]any{{"role": "user", "content": pageText}},
		"output_config": map[string]any{
			"format": map[string]any{"type": "json_schema", "schema": recipeJSONSchema},
		},
	}
	buf, err := json.Marshal(reqBody)
	if err != nil {
		return ExtractedRecipe{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/v1/messages", bytes.NewReader(buf))
	if err != nil {
		return ExtractedRecipe{}, err
	}
	req.Header.Set("content-type", "application/json")
	req.Header.Set("x-api-key", c.apiKey)
	req.Header.Set("anthropic-version", "2023-06-01")

	resp, err := c.client.Do(req)
	if err != nil {
		return ExtractedRecipe{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return ExtractedRecipe{}, fmt.Errorf("claude: status %d", resp.StatusCode)
	}

	var apiResp struct {
		StopReason string `json:"stop_reason"`
		Content    []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&apiResp); err != nil {
		return ExtractedRecipe{}, err
	}
	if apiResp.StopReason == "refusal" {
		return ExtractedRecipe{}, errors.New("claude refused the request")
	}

	var text string
	for _, block := range apiResp.Content {
		if block.Type == "text" {
			text = block.Text
			break
		}
	}
	if text == "" {
		return ExtractedRecipe{}, errors.New("claude returned no text block")
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
