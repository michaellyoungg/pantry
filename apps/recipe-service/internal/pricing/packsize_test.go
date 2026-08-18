package pricing

import "testing"

func TestParsePackSize(t *testing.T) {
	cases := []struct {
		name, raw string
		wantDim   Dimension
		wantBase  float64
		wantOK    bool
	}{
		{"gallon of milk", "1 gal", DimensionVolume, 3785.41, true},
		{"half gallon", "0.5 gal", DimensionVolume, 1892.705, true},
		{"pound of beef", "1 lb", DimensionMass, 453.592, true},
		{"five pounds of flour", "5 lb", DimensionMass, 2267.96, true},
		{"ounces are mass", "16 oz", DimensionMass, 453.592, true},
		// The one that matters most: 16 fl oz and 16 oz differ by more than a
		// factor of one, and reading either as the other invents a price.
		{"fluid ounces are volume", "16 fl oz", DimensionVolume, 473.176, true},
		{"decimal fluid ounces", "16.9 fl oz", DimensionVolume, 499.79215, true},
		{"litres", "2 liter", DimensionVolume, 2000, true},
		{"a dozen eggs", "12 ct", DimensionCount, 12, true},
		{"dozen spelled out", "1 dozen", DimensionCount, 12, true},
		{"multipack multiplies", "12 pk / 12 fl oz", DimensionVolume, 4258.584, true},
		{"uppercase", "1 GAL", DimensionVolume, 3785.41, true},
		{"recipe units still work", "500 g", DimensionMass, 500, true},

		{"marketing copy", "family size", "", 0, false},
		{"unit we do not know", "3 sleeves", "", 0, false},
		{"no number", "gal", "", 0, false},
		{"zero size", "0 gal", "", 0, false},
		{"empty", "", "", 0, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			dim, base, ok := ParsePackSize(c.raw)
			if ok != c.wantOK {
				t.Fatalf("ParsePackSize(%q) ok = %v, want %v", c.raw, ok, c.wantOK)
			}
			if !ok {
				return
			}
			if dim != c.wantDim {
				t.Errorf("dimension = %q, want %q", dim, c.wantDim)
			}
			// Float conversions: compare to the cent-irrelevant tolerance rather
			// than exactly.
			if diff := base - c.wantBase; diff > 0.001 || diff < -0.001 {
				t.Errorf("base = %v, want %v", base, c.wantBase)
			}
		})
	}
}

// A pack unit both tables know must resolve identically, or a "16 oz" pack
// would price differently from a "16 oz" recipe line.
func TestPackUnitsAgreeWithRecipeUnits(t *testing.T) {
	shared := 0
	for unit, retail := range retailUnits {
		recipeDim, recipeToBase, ok := lookupUnit(unit)
		if !ok {
			continue
		}
		shared++
		if recipeDim != retail.dimension || recipeToBase != retail.toBase {
			t.Errorf("unit %q: retail %v/%v, recipe %v/%v",
				unit, retail.dimension, retail.toBase, recipeDim, recipeToBase)
		}
	}
	if shared != 0 {
		t.Logf("compared %d shared units", shared)
	}
}
