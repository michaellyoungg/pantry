package pricing

import (
	"fmt"
	"sort"
	"time"
)

// Series is one BLS Average Price series reduced to what pricing needs: the
// most recent usable observation, and the pack size that observation is quoted
// per, expressed in the dimension's base unit.
//
// BLS quotes "Eggs, grade A, large, per doz." — so Value is dollars per dozen,
// Dimension is count and PackSize is 12, giving dollars-per-egg on division.
type Series struct {
	Title     string    `json:"title"`
	Value     float64   `json:"value"` // USD for one pack
	Month     string    `json:"month"` // "YYYY-MM" of this observation
	Dimension Dimension `json:"dimension"`
	PackSize  float64   `json:"packSize"` // grams, millilitres, or count
}

// pricePerBase returns USD per gram / millilitre / item.
func (s Series) pricePerBase() float64 { return s.Value / s.PackSize }

// Snapshot is the checked-in BLS price table. It is embedded into the binary,
// so serving a request never touches the network and a fresh clone works
// offline with no API key. cmd/pricing-refresh rewrites it.
type Snapshot struct {
	Source    string `json:"source"`
	SourceURL string `json:"sourceUrl"`
	Area      string `json:"area"`
	// ObservationMonth is the newest month present across all series and is what
	// staleness and the UI's "as of" label are computed from.
	ObservationMonth string            `json:"observationMonth"`
	FetchedAt        string            `json:"fetchedAt"`
	Series           map[string]Series `json:"series"`
}

// validate rejects a snapshot that would produce silently wrong money: a
// non-positive price or pack size divides into nonsense, and an unknown
// dimension can never match a grocery line.
func (s Snapshot) validate() error {
	if s.ObservationMonth == "" {
		return fmt.Errorf("snapshot has no observationMonth")
	}
	if _, err := parseMonth(s.ObservationMonth); err != nil {
		return fmt.Errorf("snapshot observationMonth: %w", err)
	}
	if len(s.Series) == 0 {
		return fmt.Errorf("snapshot has no series")
	}
	ids := make([]string, 0, len(s.Series))
	for id := range s.Series {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		ser := s.Series[id]
		switch ser.Dimension {
		case DimensionMass, DimensionVolume, DimensionCount:
		default:
			return fmt.Errorf("series %s: unknown dimension %q", id, ser.Dimension)
		}
		if ser.Value <= 0 {
			return fmt.Errorf("series %s: non-positive value %v", id, ser.Value)
		}
		if ser.PackSize <= 0 {
			return fmt.Errorf("series %s: non-positive packSize %v", id, ser.PackSize)
		}
		if _, err := parseMonth(ser.Month); err != nil {
			return fmt.Errorf("series %s month: %w", id, err)
		}
	}
	return nil
}

// parseMonth parses a "YYYY-MM" stamp.
func parseMonth(s string) (time.Time, error) {
	t, err := time.Parse("2006-01", s)
	if err != nil {
		return time.Time{}, fmt.Errorf("want YYYY-MM, got %q", s)
	}
	return t, nil
}
