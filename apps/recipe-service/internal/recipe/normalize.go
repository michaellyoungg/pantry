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
