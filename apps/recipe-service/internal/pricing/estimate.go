package pricing

import (
	"math"
	"time"
)

// Line is one aggregated grocery line to price. It is the BL-0003 normalized
// identity plus its quantity — deliberately not internal/recipe.GroceryLine, so
// this package stays free of any dependency on internal/recipe.
type Line struct {
	CanonicalItem string  `json:"canonicalItem"`
	Item          string  `json:"item"`
	Unit          string  `json:"unit"`
	Quantity      float64 `json:"quantity"`
}

// Reasons a line could not be priced. These are returned to the caller so the
// UI can be specific instead of silently dropping the line from the total.
const (
	ReasonNoMatch      = "no_matching_price_bucket"
	ReasonNoSeries     = "price_series_missing"
	ReasonUnitMismatch = "unit_not_convertible_to_price_unit"
	ReasonBadQuantity  = "non_positive_quantity"
)

// LineEstimate is the per-line result. Priced=false lines carry a Reason and
// contribute nothing to the total.
type LineEstimate struct {
	CanonicalItem string `json:"canonicalItem"`
	Item          string `json:"item"`
	Priced        bool   `json:"priced"`
	Cents         int    `json:"cents,omitempty"`
	Bucket        string `json:"bucket,omitempty"`
	BucketLabel   string `json:"bucketLabel,omitempty"`
	Reason        string `json:"reason,omitempty"`
	// Source names which table priced the line — SourceAverage or SourceStore.
	// Empty on an unpriced line, where there is no number to attribute.
	Source string `json:"source,omitempty"`
	// Product is the shelf item a store price came from, so "$4.29" can be shown
	// as the specific thing it is the price of. Empty for an average.
	Product string `json:"product,omitempty"`
	// OnSale marks a store price that is a promotion, not the regular shelf
	// price, and so will not last.
	OnSale bool `json:"onSale,omitempty"`
}

// Basis is the provenance the UI must show alongside any total. An estimate
// without its basis is a number pretending to be a price.
type Basis struct {
	Source           string    `json:"source"`
	SourceURL        string    `json:"sourceUrl"`
	Area             string    `json:"area"`
	ObservationMonth string    `json:"observationMonth"`
	Staleness        Staleness `json:"staleness"`
	// Store is present only when a user's chosen store priced at least one line
	// (BL-0046). The averages above still cover the rest, which is why this
	// layers rather than replaces.
	Store *StoreBasis `json:"store,omitempty"`
}

// Estimate is the whole answer: a total, how much of the list it actually
// covers, and where the numbers came from.
type Estimate struct {
	Currency      string         `json:"currency"`
	TotalCents    int            `json:"totalCents"`
	PricedCount   int            `json:"pricedCount"`
	UnpricedCount int            `json:"unpricedCount"`
	Lines         []LineEstimate `json:"lines"`
	Basis         Basis          `json:"basis"`
}

// Estimator prices grocery lines from a snapshot and a mapping. It holds no
// mutable state and is safe for concurrent use.
type Estimator struct {
	snapshot Snapshot
	matcher  *Matcher
}

// NewEstimator validates the snapshot and compiles the mapping.
func NewEstimator(s Snapshot, m MappingFile) (*Estimator, error) {
	if err := s.validate(); err != nil {
		return nil, err
	}
	mt, err := NewMatcher(m)
	if err != nil {
		return nil, err
	}
	return &Estimator{snapshot: s, matcher: mt}, nil
}

// Estimate prices every line it can and reports what it could not. It never
// returns an error: an unpriceable list is a valid answer (total 0, everything
// unpriced), because pricing must never be able to break the grocery list.
func (e *Estimator) Estimate(lines []Line) Estimate {
	return e.estimateAt(lines, time.Now())
}

// estimateAt is Estimate with an injectable clock, so staleness is testable.
func (e *Estimator) estimateAt(lines []Line, now time.Time) Estimate {
	out := e.newEstimate(lines, now)
	for _, l := range lines {
		e.accumulate(&out, e.estimateLine(l))
	}
	return out
}

// newEstimate is the empty answer with its basis filled in, shared by the
// averages-only and store-overlay paths so the two cannot describe themselves
// differently.
func (e *Estimator) newEstimate(lines []Line, now time.Time) Estimate {
	return Estimate{
		Currency: "USD",
		Lines:    make([]LineEstimate, 0, len(lines)),
		Basis: Basis{
			Source:           e.snapshot.Source,
			SourceURL:        e.snapshot.SourceURL,
			Area:             e.snapshot.Area,
			ObservationMonth: e.snapshot.ObservationMonth,
			Staleness:        stalenessAt(e.snapshot.ObservationMonth, now),
		},
	}
}

func (e *Estimator) accumulate(out *Estimate, le LineEstimate) {
	if le.Priced {
		out.PricedCount++
		// Rounding per line rather than once at the end keeps the line items
		// summing exactly to the displayed total.
		out.TotalCents += le.Cents
	} else {
		out.UnpricedCount++
	}
	out.Lines = append(out.Lines, le)
}

func (e *Estimator) estimateLine(l Line) LineEstimate {
	le := LineEstimate{CanonicalItem: l.CanonicalItem, Item: l.Item}

	// CanonicalItem is the normalized key and the right thing to match on; fall
	// back to the display text for rows written before normalization existed.
	text := l.CanonicalItem
	if text == "" {
		text = l.Item
	}

	key, bucket, ok := e.matcher.Lookup(text)
	if !ok {
		le.Reason = ReasonNoMatch
		return le
	}
	le.Bucket, le.BucketLabel = key, bucket.Label

	series, ok := e.snapshot.Series[bucket.SeriesID]
	if !ok {
		// Mapped to a bucket whose series was never fetched. Report it rather
		// than pretending the ingredient was unmappable.
		le.Reason = ReasonNoSeries
		return le
	}
	if l.Quantity <= 0 {
		le.Reason = ReasonBadQuantity
		return le
	}

	baseQty, ok := e.toSeriesBase(l, bucket, series.Dimension)
	if !ok {
		le.Reason = ReasonUnitMismatch
		return le
	}

	le.Priced = true
	le.Cents = int(math.Round(baseQty * series.pricePerBase() * 100))
	le.Source = SourceAverage
	return le
}

// toSeriesBase converts a line's quantity into the series' base unit (grams,
// millilitres, or items), bridging dimensions only where the bucket declares an
// explicit conversion. Anything it cannot convert honestly returns ok=false so
// the line is reported unpriced rather than guessed.
func (e *Estimator) toSeriesBase(l Line, b Bucket, target Dimension) (float64, bool) {
	lineDim, toBase, convertible := lookupUnit(l.Unit)

	// A non-convertible or empty unit ("2 eggs", "3 cloves") is a count.
	if !convertible {
		switch {
		case target == DimensionCount:
			return l.Quantity, true
		case target == DimensionMass && b.GramsEach > 0:
			return l.Quantity * b.GramsEach, true
		case target == DimensionVolume && b.GramsEach > 0 && b.GramsPerMl > 0:
			return l.Quantity * b.GramsEach / b.GramsPerMl, true
		default:
			return 0, false
		}
	}

	qtyInLineBase := l.Quantity * toBase // grams or millilitres
	switch {
	case lineDim == target:
		return qtyInLineBase, true
	// A recipe measures flour in cups; BLS quotes it per pound. Density is the
	// one approximation this design accepts, and only where declared.
	case lineDim == DimensionVolume && target == DimensionMass && b.GramsPerMl > 0:
		return qtyInLineBase * b.GramsPerMl, true
	case lineDim == DimensionMass && target == DimensionVolume && b.GramsPerMl > 0:
		return qtyInLineBase / b.GramsPerMl, true
	// A measured quantity can't become a count: 200 g of egg is not an egg.
	default:
		return 0, false
	}
}

// Snapshot exposes the loaded price table (for diagnostics and tests).
func (e *Estimator) Snapshot() Snapshot { return e.snapshot }

// Matcher exposes the compiled mapping (for diagnostics and tests).
func (e *Estimator) Matcher() *Matcher { return e.matcher }
