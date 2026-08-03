package nutrition

import (
	_ "embed"
	"encoding/json"
	"fmt"
)

//go:embed snapshot.json
var snapshotJSON []byte

// snapshotFile is the checked-in offline seed. See snapshot.json's `note` for
// the provenance of the numbers and why the fdcIds are negative.
type snapshotFile struct {
	Note      string     `json:"note"`
	Nutrients []Nutrient `json:"nutrients"`
	Foods     []struct {
		FDCID         int                `json:"fdcId"`
		CanonicalItem string             `json:"canonicalItem"`
		Aliases       []string           `json:"aliases"`
		Description   string             `json:"description"`
		Nutrients     map[string]float64 `json:"nutrients"`
		Portions      map[string]float64 `json:"portions"`
	} `json:"foods"`
}

type snapshotData struct {
	nutrients map[string]Nutrient
	foods     map[string]Food
}

var snapshot = mustLoadSnapshot()

func mustLoadSnapshot() snapshotData {
	d, err := loadSnapshot(snapshotJSON)
	if err != nil {
		panic(fmt.Sprintf("load nutrition snapshot: %v", err))
	}
	return d
}

func loadSnapshot(raw []byte) (snapshotData, error) {
	var f snapshotFile
	if err := json.Unmarshal(raw, &f); err != nil {
		return snapshotData{}, fmt.Errorf("parse snapshot.json: %w", err)
	}
	out := snapshotData{
		nutrients: make(map[string]Nutrient, len(f.Nutrients)),
		foods:     make(map[string]Food, len(f.Foods)),
	}
	for _, n := range f.Nutrients {
		out.nutrients[n.ID] = n
	}
	for _, sf := range f.Foods {
		if sf.CanonicalItem == "" {
			return snapshotData{}, fmt.Errorf("snapshot food %d has no canonicalItem", sf.FDCID)
		}
		if sf.FDCID >= 0 {
			// A positive id would claim to be a specific FDC record, and a later
			// refresh would then write real data over a hand-assembled row under
			// the same identity.
			return snapshotData{}, fmt.Errorf("snapshot food %q must use a negative fdcId", sf.CanonicalItem)
		}
		food := Food{
			FDCID:       sf.FDCID,
			Description: sf.Description,
			Nutrients:   sf.Nutrients,
			Portions:    sf.Portions,
			// Deliberately short of a live match: a refresh should prefer real
			// FDC data over the seed, and confidence is how that is expressed.
			MatchConfidence: 0.7,
			Source:          SourceSnapshot,
		}
		// Aliases exist because CanonicalItem passes unknown text straight
		// through, so "eggs" and "egg" are two different keys until the
		// normalization dictionary grows (BL-0031).
		for _, key := range append([]string{sf.CanonicalItem}, sf.Aliases...) {
			if prev, dup := out.foods[key]; dup {
				return snapshotData{}, fmt.Errorf("snapshot key %q claimed by both %q and %q", key, prev.Description, sf.Description)
			}
			out.foods[key] = food
		}
	}
	return out, nil
}

// SnapshotNutrients is the nutrient reference table: FDC nutrient number -> name
// and unit. It is static reference data, so it is read from the embedded
// snapshot rather than the database — a missing nutrients row can then never
// strip the units off an estimate.
func SnapshotNutrients() map[string]Nutrient { return snapshot.nutrients }

// SnapshotFoods is the offline food seed, keyed by canonical ingredient
// (including aliases).
func SnapshotFoods() map[string]Food { return snapshot.foods }

// SnapshotProvider serves the checked-in seed. It is the bottom layer of the
// provider chain: whatever FDC cannot be asked for — no key, rate limited,
// offline — these common ingredients still resolve.
func SnapshotProvider() *StaticProvider { return NewStaticProvider(snapshot.foods) }
