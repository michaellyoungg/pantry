package recipe

import (
	_ "embed"
	"encoding/json"
	"fmt"
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
}

type normalizationData struct {
	Units      map[string]unitDef `json:"units"`
	Synonyms   map[string]string  `json:"synonyms"`
	Items      map[string]itemDef `json:"items"`
	AisleOrder []string           `json:"aisleOrder"`
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
	norm := strings.ToLower(strings.TrimSpace(raw))
	if syn, ok := n.data.Synonyms[norm]; ok {
		norm = syn
	}
	if it, ok := n.data.Items[norm]; ok {
		return norm, it.Display, it.Aisle
	}
	return norm, strings.TrimSpace(raw), "other"
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
