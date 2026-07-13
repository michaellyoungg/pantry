package recipe

import (
	"encoding/json"
	"html"
	"regexp"
	"strings"
)

// ldScriptRe matches the inner text of every <script type="application/ld+json">.
var ldScriptRe = regexp.MustCompile(`(?is)<script[^>]*type\s*=\s*["']application/ld\+json["'][^>]*>(.*?)</script>`)

type jsonLDRecipe struct {
	Title           string
	IngredientLines []string
	Steps           []string
}

// extractJSONLD scans a page for schema.org Recipe JSON-LD and returns the first
// Recipe node found. ok is false when no usable Recipe node is present.
func extractJSONLD(html []byte) (jsonLDRecipe, bool) {
	for _, m := range ldScriptRe.FindAllSubmatch(html, -1) {
		var doc any
		if err := json.Unmarshal(m[1], &doc); err != nil {
			continue
		}
		if rec, ok := findRecipeNode(doc); ok {
			return rec, true
		}
	}
	return jsonLDRecipe{}, false
}

// findRecipeNode walks arrays and @graph wrappers looking for a Recipe object.
func findRecipeNode(node any) (jsonLDRecipe, bool) {
	switch v := node.(type) {
	case []any:
		for _, item := range v {
			if rec, ok := findRecipeNode(item); ok {
				return rec, true
			}
		}
	case map[string]any:
		if hasType(v["@type"], "Recipe") {
			return buildRecipe(v), true
		}
		if g, ok := v["@graph"]; ok {
			return findRecipeNode(g)
		}
	}
	return jsonLDRecipe{}, false
}

// hasType reports whether a JSON-LD @type (a string or list of strings) includes want.
func hasType(t any, want string) bool {
	switch v := t.(type) {
	case string:
		return v == want
	case []any:
		for _, item := range v {
			if s, ok := item.(string); ok && s == want {
				return true
			}
		}
	}
	return false
}

func buildRecipe(m map[string]any) jsonLDRecipe {
	rec := jsonLDRecipe{Title: asString(m["name"])}
	for _, ing := range asStringSlice(m["recipeIngredient"]) {
		if s := cleanText(ing); s != "" {
			rec.IngredientLines = append(rec.IngredientLines, s)
		}
	}
	rec.Steps = extractSteps(m["recipeInstructions"])
	return rec
}

// cleanText decodes HTML entities (recipe sites routinely encode e.g. "&#39;"
// inside JSON-LD strings) and trims surrounding whitespace.
func cleanText(s string) string {
	return strings.TrimSpace(html.UnescapeString(s))
}

func asString(v any) string {
	s, _ := v.(string)
	return cleanText(s)
}

// asStringSlice accepts a string or a list of strings and returns a slice.
func asStringSlice(v any) []string {
	switch t := v.(type) {
	case string:
		return []string{t}
	case []any:
		out := make([]string, 0, len(t))
		for _, item := range t {
			if s, ok := item.(string); ok {
				out = append(out, s)
			}
		}
		return out
	}
	return nil
}

// extractSteps handles recipeInstructions as a string, a list of strings, or a
// list of HowToStep/HowToSection objects carrying a "text" field.
func extractSteps(v any) []string {
	var out []string
	switch t := v.(type) {
	case string:
		if s := cleanText(t); s != "" {
			out = append(out, s)
		}
	case []any:
		for _, item := range t {
			switch step := item.(type) {
			case string:
				if s := cleanText(step); s != "" {
					out = append(out, s)
				}
			case map[string]any:
				if s := asString(step["text"]); s != "" {
					out = append(out, s)
				}
			}
		}
	}
	return out
}
