package nutrition

import (
	"strings"
	"testing"
)

func TestSnapshotLoads(t *testing.T) {
	foods, nutrients := SnapshotFoods(), SnapshotNutrients()
	if len(foods) == 0 || len(nutrients) == 0 {
		t.Fatalf("snapshot is empty: %d foods, %d nutrients", len(foods), len(nutrients))
	}

	// The nutrients the first UI surfaces, per the design's non-goals.
	for _, id := range []string{"1008", "1003", "1004", "1005", "1079", "1258", "1253", "1093"} {
		n, ok := nutrients[id]
		if !ok {
			t.Errorf("nutrient %s missing from the reference table", id)
			continue
		}
		if n.Name == "" || n.Unit == "" {
			t.Errorf("nutrient %s = %+v, want a name and a unit", id, n)
		}
	}
}

func TestSnapshotFoodInvariants(t *testing.T) {
	for key, food := range SnapshotFoods() {
		if food.Source != SourceSnapshot {
			t.Errorf("%s: Source = %q, want %q", key, food.Source, SourceSnapshot)
		}
		// Negative ids are what keep hand-assembled rows from claiming to be a
		// specific FDC record — see snapshot.json's note.
		if food.FDCID >= 0 {
			t.Errorf("%s: fdcId = %d, want negative", key, food.FDCID)
		}
		if food.Description == "" {
			t.Errorf("%s: no description", key)
		}
		if len(food.Nutrients) == 0 {
			t.Errorf("%s: no nutrients — an entry with no vector cannot resolve", key)
		}
		if len(food.Portions) == 0 {
			t.Errorf("%s: no portions — nothing but a mass line could use this entry", key)
		}
		if _, ok := food.Nutrients["1008"]; !ok {
			t.Errorf("%s: no energy (1008)", key)
		}
		for id := range food.Nutrients {
			if _, ok := SnapshotNutrients()[id]; !ok {
				t.Errorf("%s: nutrient %s is not in the reference table", key, id)
			}
		}
		for portion, grams := range food.Portions {
			if portionKey(portion) != portion {
				t.Errorf("%s: portion %q is not in normalized form (%q)", key, portion, portionKey(portion))
			}
			if grams <= 0 {
				t.Errorf("%s: portion %q weighs %v", key, portion, grams)
			}
		}
	}
}

// Every alias must be reachable through the same canonicalization the estimator
// applies, or it is dead data.
func TestSnapshotKeysAreCanonical(t *testing.T) {
	n := testNormalizer{}
	for key := range SnapshotFoods() {
		canonical, _, _ := n.CanonicalItem(key)
		if canonical != key {
			t.Errorf("snapshot key %q canonicalizes to %q, so it can never be hit", key, canonical)
		}
		if key != strings.ToLower(key) {
			t.Errorf("snapshot key %q is not lowercase", key)
		}
	}
}

func TestLoadSnapshotRejectsBadData(t *testing.T) {
	tests := []struct {
		name, raw, wantErr string
	}{
		{"not json", `{`, "parse"},
		{
			"positive fdc id", `{"foods":[{"fdcId":123,"canonicalItem":"x"}]}`,
			"negative fdcId",
		},
		{
			"missing canonical item", `{"foods":[{"fdcId":-1,"canonicalItem":""}]}`,
			"no canonicalItem",
		},
		{
			// Two foods claiming one key would make lookups depend on map order.
			"duplicate key",
			`{"foods":[{"fdcId":-1,"canonicalItem":"x","description":"A"},{"fdcId":-2,"canonicalItem":"y","aliases":["x"],"description":"B"}]}`,
			"claimed by both",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := loadSnapshot([]byte(tt.raw))
			if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
				t.Errorf("err = %v, want it to mention %q", err, tt.wantErr)
			}
		})
	}
}
