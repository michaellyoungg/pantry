package recipe

import (
	"fmt"
	"net/url"
	"strings"
)

// Discovery metadata (BL-0020): the fields the catalog's filter chips read.
//
// `cuisine` and `tags` are deliberately an OPEN vocabulary, unlike the closed
// cooking-method enum next door. Methods are closed because BL-0042's prep
// rules key on them — a rule cannot be written against values that vary per
// recipe. Nothing keys on a cuisine or a tag: they exist to be searched and
// filtered, and an import that meets a cuisine we have never heard of should
// keep it rather than drop it on the floor. What we DO enforce is a single
// spelling, so "Gluten Free", "gluten_free" and "GLUTEN-FREE" are one chip and
// not three.

const (
	// maxTagLen bounds one tag/cuisine slug. Long enough for "mediterranean" and
	// "pressure-cooker-friendly", short enough that a tag is never prose.
	maxTagLen = 40
	// maxTags bounds the set. A recipe with fifty tags has no tags.
	maxTags = 20
	// maxSourceURLLen matches the conservative end of what browsers accept.
	maxSourceURLLen = 2048
	// maxTotalMinutes is a week. Generous on purpose: brines, ferments and
	// long marinades are real, and the point of the cap is to reject garbage
	// (a timestamp pasted into the field), not to referee cooking.
	maxTotalMinutes = 60 * 24 * 7
)

// slugify folds a free-text label into the single spelling we store: lowercase,
// with any run of separators collapsed to one hyphen. Characters outside
// [a-z0-9-] are dropped rather than transliterated — this is a join key, and a
// lossy-but-stable key beats a clever one that differs by Go version.
//
// Returns "" for input that has no usable characters, which callers treat as
// "absent" rather than as an empty-string value.
func slugify(s string) string {
	var b strings.Builder
	lastHyphen := true // leading hyphens are trimmed by never emitting one first
	for _, r := range strings.ToLower(strings.TrimSpace(s)) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
			lastHyphen = false
		case r == ' ', r == '\t', r == '\n', r == '_', r == '-', r == '/', r == ',':
			if !lastHyphen && b.Len() > 0 {
				b.WriteByte('-')
				lastHyphen = true
			}
		}
	}
	return strings.TrimSuffix(b.String(), "-")
}

// normTags slugifies a tag list, dropping blanks and duplicates while keeping
// first-seen order — catalog entries are hand-authored, so their order carries
// intent that sorting would destroy. Always returns a non-nil slice so the JSON
// contract stays [] rather than null.
func normTags(tags []string) []string {
	out := make([]string, 0, len(tags))
	seen := make(map[string]bool, len(tags))
	for _, t := range tags {
		slug := slugify(t)
		if slug == "" || seen[slug] {
			continue
		}
		seen[slug] = true
		out = append(out, slug)
	}
	return out
}

// ValidateDiscovery checks the discovery metadata a client supplied, and
// returns the normalized values to store. It is the single place create,
// update, catalog loading and import all agree on, so a hand-typed cuisine and
// an imported one can never end up as different chips.
func ValidateDiscovery(cuisine string, totalMinutes *int, tags []string, sourceURL string) (string, []string, string, error) {
	normCuisine := slugify(cuisine)
	if len(normCuisine) > maxTagLen {
		return "", nil, "", fmt.Errorf("cuisine must be at most %d characters", maxTagLen)
	}

	if totalMinutes != nil && (*totalMinutes < 1 || *totalMinutes > maxTotalMinutes) {
		return "", nil, "", fmt.Errorf("totalMinutes must be between 1 and %d, or omitted", maxTotalMinutes)
	}

	normalized := normTags(tags)
	if len(normalized) > maxTags {
		return "", nil, "", fmt.Errorf("at most %d tags are allowed", maxTags)
	}
	for _, t := range normalized {
		if len(t) > maxTagLen {
			return "", nil, "", fmt.Errorf("tag %q is longer than %d characters", t, maxTagLen)
		}
	}

	normSource, err := normSourceURL(sourceURL)
	if err != nil {
		return "", nil, "", err
	}
	return normCuisine, normalized, normSource, nil
}

// normSourceURL validates the attribution link. Empty is always fine — most
// recipes have no source — but a non-empty value has to be a real absolute
// http(s) URL, because the UI renders it as a link and re-import feeds it back
// to the fetcher. Anything else (javascript:, file:, a bare hostname) is
// rejected here rather than becoming a broken link later.
func normSourceURL(raw string) (string, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "", nil
	}
	if len(trimmed) > maxSourceURLLen {
		return "", fmt.Errorf("sourceUrl must be at most %d characters", maxSourceURLLen)
	}
	u, err := url.Parse(trimmed)
	if err != nil {
		return "", fmt.Errorf("sourceUrl is not a valid url: %w", err)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return "", fmt.Errorf("sourceUrl must be an http or https url")
	}
	if u.Host == "" {
		return "", fmt.Errorf("sourceUrl must include a host")
	}
	return trimmed, nil
}
