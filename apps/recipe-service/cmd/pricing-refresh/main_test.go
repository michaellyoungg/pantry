package main

import (
	"math"
	"testing"

	"pantry/apps/recipe-service/internal/pricing"
)

// Titles are copied verbatim from the BLS AP series catalog. Getting a pack size
// wrong here scales every price derived from that series, silently — so every
// title shape the mapped series actually use is pinned.
func TestParsePack(t *testing.T) {
	cases := []struct {
		title    string
		wantDim  pricing.Dimension
		wantPack float64
	}{
		{"Flour, white, all purpose, per lb. (453.6 gm) in U.S. city average, average price, not seasonally adjusted", pricing.DimensionMass, 453.592},
		{"Eggs, grade A, large, per doz. in U.S. city average, average price, not seasonally adjusted", pricing.DimensionCount, 12},
		{"Milk, fresh, whole, fortified, per gal. (3.8 lit) in U.S. city average, average price, not seasonally adjusted", pricing.DimensionVolume, 3785.41},
		{"Ice cream, prepackaged, bulk, regular, per 1/2 gal. (1.9 lit) in U.S. city average, average price, not seasonally adjusted", pricing.DimensionVolume, 1892.705},
		// The parenthetical is the only thing distinguishing fluid ounces from
		// weight ounces, and BLS uses both.
		{"Malt beverages, all types, all sizes, any origin, per 16 oz. (473.2 ml) in U.S. city average, average price, not seasonally adjusted", pricing.DimensionVolume, 473.2},
		{"Yogurt, per 8 oz. (226.8 gm) in U.S. city average, average price, not seasonally adjusted", pricing.DimensionMass, 226.8},
		{"Strawberries, dry pint, per 12 oz. (340.2 gm) in U.S. city average, average price, not seasonally adjusted", pricing.DimensionMass, 340.2},
		// No parenthetical at all: BLS means weight ounces.
		{"Potato chips, per 16 oz. in U.S. city average, average price, not seasonally adjusted", pricing.DimensionMass, 453.592},
		{"Wine, red and white table, all sizes, any origin, per 1 liter (33.8 oz) in U.S. city average, average price, not seasonally adjusted", pricing.DimensionVolume, 1000},
		{"All soft drinks, per 2 liters (67.6 oz) in U.S. city average, average price, not seasonally adjusted", pricing.DimensionVolume, 2000},
	}
	for _, c := range cases {
		dim, pack, err := parsePack(c.title)
		if err != nil {
			t.Errorf("parsePack(%.40q...): %v", c.title, err)
			continue
		}
		if dim != c.wantDim {
			t.Errorf("parsePack(%.40q...) dimension = %q, want %q", c.title, dim, c.wantDim)
		}
		if math.Abs(pack-c.wantPack) > 0.01 {
			t.Errorf("parsePack(%.40q...) pack = %v, want %v", c.title, pack, c.wantPack)
		}
	}
}

func TestParsePackRejectsUnknownUnits(t *testing.T) {
	for _, title := range []string{
		"Electricity per KWH in U.S. city average, average price, not seasonally adjusted",
		"Utility (piped) gas per therm in U.S. city average, average price, not seasonally adjusted",
		"Something with no per clause at all",
	} {
		if _, _, err := parsePack(title); err == nil {
			t.Errorf("parsePack(%.40q...) succeeded; want an error", title)
		}
	}
}

func TestParseQuantity(t *testing.T) {
	cases := []struct {
		in   string
		want float64
	}{{"", 1}, {"2", 2}, {"1/2", 0.5}, {"16", 16}}
	for _, c := range cases {
		got, err := parseQuantity(c.in)
		if err != nil || got != c.want {
			t.Errorf("parseQuantity(%q) = %v, %v; want %v", c.in, got, err, c.want)
		}
	}
	if _, err := parseQuantity("1/0"); err == nil {
		t.Error("parseQuantity(\"1/0\") succeeded; want an error")
	}
}

func TestShortTitle(t *testing.T) {
	got := shortTitle("Yogurt, per 8 oz. (226.8 gm) in U.S. city average, average price, not seasonally adjusted")
	if want := "Yogurt, per 8 oz. (226.8 gm)"; got != want {
		t.Errorf("shortTitle = %q, want %q", got, want)
	}
}
