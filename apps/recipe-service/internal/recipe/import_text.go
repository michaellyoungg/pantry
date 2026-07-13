package recipe

import (
	"html"
	"regexp"
	"strings"
)

const maxLLMChars = 12000

var (
	scriptStyleRe = regexp.MustCompile(`(?is)<(script|style)[^>]*>.*?</(script|style)>`)
	tagRe         = regexp.MustCompile(`(?s)<[^>]+>`)
	wsRe          = regexp.MustCompile(`\s+`)
)

// htmlToText produces a compact plain-text rendering of a page for the LLM:
// scripts/styles removed, tags stripped, entities unescaped, whitespace
// collapsed, and truncated to a token-bounding character budget.
func htmlToText(raw []byte) string {
	s := scriptStyleRe.ReplaceAllString(string(raw), " ")
	s = tagRe.ReplaceAllString(s, " ")
	s = html.UnescapeString(s)
	s = strings.TrimSpace(wsRe.ReplaceAllString(s, " "))
	if len(s) > maxLLMChars {
		s = s[:maxLLMChars]
	}
	return s
}
