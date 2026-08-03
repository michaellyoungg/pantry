package pricing

import (
	"fmt"
	"sort"
	"strings"
	"unicode"
)

// Bucket maps a coarse BLS price series onto the ingredient strings that should
// be priced from it. BLS publishes ~56 active food series, so many normalized
// ingredients necessarily share one bucket — "penne", "spaghetti" and "rigatoni"
// are all priced from "Spaghetti and macaroni, per lb.".
//
// Dimension is NOT declared here: it is a property of the BLS series' pack unit
// and comes from the snapshot. GramsPerMl and GramsEach are the optional bridges
// that let a volume-measured line price against a mass-quoted series (and a
// counted line against either).
type Bucket struct {
	SeriesID string   `json:"seriesId"`
	Label    string   `json:"label"`
	Match    []string `json:"match"`
	Exclude  []string `json:"exclude,omitempty"`
	// GramsPerMl bridges volume <-> mass. Declared only where the density is
	// uncontroversial (flour, sugar, rice); absent means "do not guess".
	GramsPerMl float64 `json:"gramsPerMl,omitempty"`
	// GramsEach bridges a counted line onto a mass-quoted series (one large egg
	// is ~50 g). Absent means a counted line against a mass series is unpriced.
	GramsEach float64 `json:"gramsEach,omitempty"`
}

// MappingFile is the on-disk shape of pricing_map.json.
type MappingFile struct {
	Buckets map[string]Bucket `json:"buckets"`
}

// phrase is one compiled match rule: the folded tokens to look for and the
// bucket they select.
type phrase struct {
	tokens []string
	bucket string
	// raw is the phrase as authored, kept for error messages and tests.
	raw string
}

// Matcher resolves ingredient text to a bucket key. Longest matching phrase
// wins, so "ground beef" beats "beef" and "chicken breast" beats "chicken"
// without a hand-maintained priority list.
type Matcher struct {
	buckets  map[string]Bucket
	phrases  []phrase
	excludes map[string][][]string // bucket key -> folded exclusion token runs
}

// NewMatcher compiles a mapping into a matcher. It rejects empty match phrases
// and duplicate phrases across buckets, since either makes resolution ambiguous.
func NewMatcher(m MappingFile) (*Matcher, error) {
	mt := &Matcher{
		buckets:  m.Buckets,
		excludes: map[string][][]string{},
	}
	owner := map[string]string{}
	for key, b := range m.Buckets {
		if len(b.Match) == 0 {
			return nil, fmt.Errorf("bucket %q has no match phrases", key)
		}
		for _, raw := range b.Match {
			toks := foldTokens(raw)
			if len(toks) == 0 {
				return nil, fmt.Errorf("bucket %q has an empty match phrase %q", key, raw)
			}
			folded := strings.Join(toks, " ")
			if prev, dup := owner[folded]; dup {
				return nil, fmt.Errorf("match phrase %q claimed by both %q and %q", raw, prev, key)
			}
			owner[folded] = key
			mt.phrases = append(mt.phrases, phrase{tokens: toks, bucket: key, raw: raw})
		}
		for _, raw := range b.Exclude {
			if toks := foldTokens(raw); len(toks) > 0 {
				mt.excludes[key] = append(mt.excludes[key], toks)
			}
		}
	}

	// Sort most-specific first so the first hit is the winner: more tokens, then
	// longer text, then bucket key. The final key comparison makes the outcome
	// independent of Go's randomized map iteration order.
	sort.Slice(mt.phrases, func(i, j int) bool {
		a, b := mt.phrases[i], mt.phrases[j]
		if len(a.tokens) != len(b.tokens) {
			return len(a.tokens) > len(b.tokens)
		}
		la, lb := len(strings.Join(a.tokens, " ")), len(strings.Join(b.tokens, " "))
		if la != lb {
			return la > lb
		}
		return a.bucket < b.bucket
	})
	return mt, nil
}

// Lookup resolves ingredient text to a bucket. ok is false when nothing matches
// or when every candidate was disqualified by an exclusion — both of which mean
// "we cannot price this", never "price it as the nearest thing we have".
func (m *Matcher) Lookup(text string) (key string, b Bucket, ok bool) {
	toks := foldTokens(text)
	if len(toks) == 0 {
		return "", Bucket{}, false
	}
	for _, p := range m.phrases {
		if !containsRun(toks, p.tokens) {
			continue
		}
		if m.excluded(p.bucket, toks) {
			continue
		}
		return p.bucket, m.buckets[p.bucket], true
	}
	return "", Bucket{}, false
}

// excluded reports whether any of the bucket's exclusion phrases appears in the
// ingredient tokens. This is what stops "chicken broth" pricing as whole chicken
// and "almond milk" pricing as dairy milk.
func (m *Matcher) excluded(bucket string, toks []string) bool {
	for _, ex := range m.excludes[bucket] {
		if containsRun(toks, ex) {
			return true
		}
	}
	return false
}

// containsRun reports whether need appears as a contiguous run of tokens in hay.
// Matching whole tokens (never substrings) is what keeps "egg" out of "eggplant".
func containsRun(hay, need []string) bool {
	if len(need) == 0 || len(need) > len(hay) {
		return false
	}
	for i := 0; i+len(need) <= len(hay); i++ {
		match := true
		for j := range need {
			if hay[i+j] != need[j] {
				match = false
				break
			}
		}
		if match {
			return true
		}
	}
	return false
}

// foldTokens lowercases, strips punctuation, and singularizes each word.
//
// The same folding is applied to both the authored phrase and the ingredient
// text, so a linguistically "wrong" stem is harmless as long as it is
// consistent: "strawberries" and "strawberry" both fold to "strawberry", and
// it would not matter if they both folded to "strawberrie".
func foldTokens(s string) []string {
	fields := strings.FieldsFunc(strings.ToLower(s), func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r) && r != '%'
	})
	out := make([]string, 0, len(fields))
	for _, f := range fields {
		if f = singularize(f); f != "" {
			out = append(out, f)
		}
	}
	return out
}

// singularize applies a deliberately small set of English plural rules. It only
// has to be consistent, not correct — see foldTokens.
func singularize(w string) string {
	switch {
	case len(w) >= 5 && strings.HasSuffix(w, "ies"):
		return w[:len(w)-3] + "y" // strawberries -> strawberry
	case len(w) >= 5 && strings.HasSuffix(w, "oes"):
		return w[:len(w)-2] // tomatoes -> tomato
	case len(w) >= 5 && (strings.HasSuffix(w, "ches") || strings.HasSuffix(w, "shes") || strings.HasSuffix(w, "xes")):
		return w[:len(w)-2] // peaches -> peach
	case strings.HasSuffix(w, "ss"):
		return w // glass, grass
	case len(w) >= 4 && strings.HasSuffix(w, "s"):
		return w[:len(w)-1] // eggs -> egg
	}
	return w
}
