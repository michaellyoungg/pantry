package recipe

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strings"
)

//go:embed normalization.json
var normalizationJSON []byte

type unitDef struct {
	Dimension string  `json:"dimension"`
	ToBase    float64 `json:"toBase"`
	Display   bool    `json:"display"`
}

type itemDef struct {
	Display string `json:"display"`
	Aisle   string `json:"aisle"`
	// ShelfLifeDays overrides the aisle default. 0 means "use the aisle
	// default", not "expires today".
	ShelfLifeDays int `json:"shelfLifeDays,omitempty"`
	// Category is what an ingredient *is* — "protein", "dairy", "legume" —
	// as opposed to Aisle, which is where it is sold. Prep rules (BL-0042)
	// key on it: "thaw the frozen protein" is a fact about proteins, not
	// about the meat aisle, and tofu is a protein sold in produce.
	//
	// Deliberately partial: an item only carries a category where a rule
	// actually keys on one, so the field stays a claim we can defend rather
	// than a taxonomy invented to fill a column. Empty means "unclassified",
	// which no category rule matches.
	Category string `json:"category,omitempty"`
}

type normalizationData struct {
	Units    map[string]unitDef `json:"units"`
	Synonyms map[string]string  `json:"synonyms"`
	Items    map[string]itemDef `json:"items"`
	// AisleShelfLife is the per-aisle fallback for items with no explicit
	// shelf life. "other" is deliberately absent: an item we failed to
	// recognize is one whose shelf life we genuinely do not know, and
	// inventing a number for it is a guess dressed up as data (BL-0029).
	AisleShelfLife map[string]int `json:"aisleShelfLife"`
	AisleOrder     []string       `json:"aisleOrder"`
}

// ItemDetails is everything the normalizer knows about one ingredient. It is
// the wire shape of POST /normalization/lookup, which is how Convex reads shelf
// life without keeping a second copy of the table.
type ItemDetails struct {
	CanonicalItem string `json:"canonicalItem"`
	Display       string `json:"display"`
	Aisle         string `json:"aisle"`
	// ShelfLifeDays is omitted rather than zeroed when unknown, so callers can
	// tell "we don't know" apart from "it expires today".
	ShelfLifeDays int `json:"shelfLifeDays,omitempty"`
	// Category is the what-is-it axis prep rules match on; empty when the item
	// is unclassified or unknown. See itemDef.Category.
	Category string `json:"category,omitempty"`
	// Known reports whether the dataset actually recognized the item. Unknown
	// items still get a CanonicalItem — the normalized raw text — so callers
	// can group by it, but nothing else about them is asserted. Callers that
	// need to tell "we know this is bread" from "we have never seen this word"
	// must read this rather than inferring it from an "other" aisle.
	Known bool `json:"known"`
}

// displayUnit is one rung of a dimension's friendly-display ladder.
type displayUnit struct {
	unit   string
	toBase float64
}

// Normalizer resolves ingredient synonyms, unit conversions, and aisles from the
// embedded normalization dataset. Built once via loadNormalizer; all methods are
// pure reads.
type Normalizer struct {
	data     normalizationData
	ladders  map[string][]displayUnit // dimension -> rungs, smallest toBase first
	aisleIdx map[string]int
}

func loadNormalizer(raw []byte) (*Normalizer, error) {
	var d normalizationData
	if err := json.Unmarshal(raw, &d); err != nil {
		return nil, fmt.Errorf("parse normalization.json: %w", err)
	}
	ladders := map[string][]displayUnit{}
	for name, u := range d.Units {
		if u.Display {
			ladders[u.Dimension] = append(ladders[u.Dimension], displayUnit{unit: name, toBase: u.ToBase})
		}
	}
	for dim := range ladders {
		l := ladders[dim]
		sort.Slice(l, func(i, j int) bool { return l[i].toBase < l[j].toBase })
		ladders[dim] = l
	}
	aisleIdx := map[string]int{}
	for i, a := range d.AisleOrder {
		aisleIdx[a] = i
	}
	return &Normalizer{data: d, ladders: ladders, aisleIdx: aisleIdx}, nil
}

var normalizer = mustLoadNormalizer()

func mustLoadNormalizer() *Normalizer {
	n, err := loadNormalizer(normalizationJSON)
	if err != nil {
		panic(fmt.Sprintf("load normalization.json: %v", err))
	}
	return n
}

// CanonicalItem resolves raw item text to a canonical key, a human display name,
// and a grocery aisle. Unknown items pass through: display keeps the first-seen
// original (trimmed) casing and the aisle is "other".
func (n *Normalizer) CanonicalItem(raw string) (canonical, display, aisle string) {
	d := n.Details(raw)
	return d.CanonicalItem, d.Display, d.Aisle
}

// Details is CanonicalItem plus shelf life. Resolution order is
// per-item -> aisle default -> none.
func (n *Normalizer) Details(raw string) ItemDetails {
	norm := strings.ToLower(strings.TrimSpace(raw))
	if syn, ok := n.data.Synonyms[norm]; ok {
		norm = syn
	}
	if it, ok := n.data.Items[norm]; ok {
		return n.detailsFor(norm, it)
	}
	// Guarded plural folding. Real ingredient text is overwhelmingly plural
	// ("2 tomatoes", "3 eggs") while the table is keyed on singulars, so a
	// literal-only lookup would drop most perishables into "other". A fold is
	// accepted ONLY when the singular is itself a known item or synonym, which
	// is what keeps "asparagus" from being butchered into "asparagu".
	for _, cand := range singularCandidates(norm) {
		if syn, ok := n.data.Synonyms[cand]; ok {
			cand = syn
		}
		if it, ok := n.data.Items[cand]; ok {
			return n.detailsFor(cand, it)
		}
	}
	return ItemDetails{CanonicalItem: norm, Display: strings.TrimSpace(raw), Aisle: "other"}
}

func (n *Normalizer) detailsFor(canonical string, it itemDef) ItemDetails {
	shelf := it.ShelfLifeDays
	if shelf == 0 {
		shelf = n.data.AisleShelfLife[it.Aisle] // 0 when the aisle has no default
	}
	return ItemDetails{
		CanonicalItem: canonical,
		Display:       it.Display,
		Aisle:         it.Aisle,
		ShelfLifeDays: shelf,
		Category:      it.Category,
		Known:         true,
	}
}

// Categories returns every category the dataset asserts. It exists so the prep
// rule loader can reject a rule that keys on a category no item carries — a
// typo there is silent otherwise: the rule simply never fires.
func (n *Normalizer) Categories() map[string]bool {
	out := map[string]bool{}
	for _, it := range n.data.Items {
		if it.Category != "" {
			out[it.Category] = true
		}
	}
	return out
}

// singularCandidates returns plural-to-singular guesses, most specific first.
// They are only ever accepted if the table already knows them, so an over-eager
// rule here cannot invent a canonical key.
func singularCandidates(s string) []string {
	switch {
	case strings.HasSuffix(s, "ies") && len(s) > 3:
		return []string{s[:len(s)-3] + "y", s[:len(s)-1]}
	case strings.HasSuffix(s, "es") && len(s) > 2:
		return []string{s[:len(s)-2], s[:len(s)-1]}
	case strings.HasSuffix(s, "s") && !strings.HasSuffix(s, "ss") && len(s) > 1:
		return []string{s[:len(s)-1]}
	}
	return nil
}

// Unit reports the dimension and base-unit factor for a convertible unit.
// ok is false for anything not in the dataset (non-convertible: "", clove, ...).
func (n *Normalizer) Unit(raw string) (dimension string, toBase float64, ok bool) {
	u, ok := n.data.Units[strings.ToLower(strings.TrimSpace(raw))]
	if !ok {
		return "", 0, false
	}
	return u.Dimension, u.ToBase, true
}

// aisleRank returns the shopping-flow index of an aisle; unknown aisles sort last.
func (n *Normalizer) aisleRank(aisle string) int {
	if i, ok := n.aisleIdx[aisle]; ok {
		return i
	}
	return len(n.data.AisleOrder)
}

const (
	niceEpsilon   = 0.02
	bulkThreshold = 4.0
)

// niceFracs are the fractional parts we snap to (quarters, thirds, halves).
var niceFracs = []float64{0, 0.25, 1.0 / 3.0, 0.5, 2.0 / 3.0, 0.75, 1.0}

// niceValue snaps v to the nearest whole+nice-fraction within niceEpsilon.
// ok is false when v is not close to any nice value.
func niceValue(v float64) (float64, bool) {
	whole := math.Floor(v)
	frac := v - whole
	best, bestDist := 0.0, math.Inf(1)
	for _, f := range niceFracs {
		if d := math.Abs(frac - f); d < bestDist {
			bestDist, best = d, f
		}
	}
	if bestDist <= niceEpsilon {
		return math.Round((whole+best)*1000) / 1000, true
	}
	return 0, false
}

// snapNice returns v snapped to a nice value, or rounded to 2 decimals otherwise.
// This also erases float-sum noise like 0.1 + 0.2.
func snapNice(v float64) float64 {
	if s, ok := niceValue(v); ok {
		return s
	}
	return math.Round(v*100) / 100
}

// Friendly picks the largest display unit in which baseQty reads cleanly and
// returns the snapped quantity in that unit. It promotes to a larger unit when
// the amount is at least a whole there, or when the amount is bulky in the
// smaller unit (>= bulkThreshold) and lands on a nice fraction in the larger.
func (n *Normalizer) Friendly(dimension string, baseQty float64) (float64, string) {
	ladder := n.ladders[dimension]
	if len(ladder) == 0 {
		return snapNice(baseQty), dimension
	}
	idx := 0
	for idx < len(ladder)-1 {
		cur := ladder[idx]
		next := ladder[idx+1]
		q0 := baseQty / cur.toBase
		q1 := baseQty / next.toBase
		snapped1, ok1 := niceValue(q1)
		if q1 >= 1 || (ok1 && snapped1 >= 1) || (ok1 && snapped1 >= 0.25 && snapped1 < 1 && q0 >= bulkThreshold) {
			idx++
			continue
		}
		break
	}
	chosen := ladder[idx]
	return snapNice(baseQty / chosen.toBase), chosen.unit
}
