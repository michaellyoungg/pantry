package pricing

import (
	"context"
	"math"
	"sort"
	"time"
)

// Real store prices (BL-0046 — increment 2).
//
// The BLS snapshot is a national monthly average for a generic item. A user who
// opts in by choosing a store gets that store's shelf price instead, for the
// lines a real product could be matched to; every other line keeps the average.
// This file is the seam only — it holds no HTTP client and names no retailer,
// so internal/pricing stays offline-by-default and a second provider is a new
// implementation of StorePricer rather than a change here.

// PriceSource records which table a priced line's number came from, so the UI
// can say "your store" or "national average" rather than implying one accuracy
// for both.
const (
	SourceStore   = "store"
	SourceAverage = "average"
)

// StoreQuery is one grocery line's identity plus the text to look it up by.
// Callers batch these so a whole list costs one round of lookups.
type StoreQuery struct {
	// Key is the line's normalized identity, and the key quotes come back under.
	Key string
	// Term is what to search the retailer's catalogue for.
	Term string
}

// StoreQuote is one shelf price, reduced to the same shape as a BLS Series: a
// price for a pack, and that pack's size in a dimension's base unit.
type StoreQuote struct {
	// Description is the product as the retailer sells it, so the UI can show
	// what was actually priced rather than an unexplained number.
	Description string
	Cents       int
	Dimension   Dimension
	PackSize    float64
	// OnSale is true when the retailer quoted a promotional price below the
	// regular one, and Cents is that promotional price.
	OnSale bool
}

// centsPerBase returns cents per gram / millilitre / item.
func (q StoreQuote) centsPerBase() float64 { return float64(q.Cents) / q.PackSize }

// StoreQuotes is a store's answer for one batch: the quotes it could fill,
// keyed by StoreQuery.Key, plus the provenance the UI must show with them.
type StoreQuotes struct {
	Provider   string
	LocationID string
	StoreName  string
	FetchedAt  time.Time
	Quotes     map[string]StoreQuote
}

// StorePricer resolves real shelf prices at one store. Implementations live
// outside this package (internal/kroger is the first).
//
// It returns an error only when it produced nothing usable; a partial answer is
// a success, because a list priced half from the shelf and half from the
// average is strictly better than the average alone.
type StorePricer interface {
	Provider() string
	Quote(ctx context.Context, locationID string, queries []StoreQuery) (StoreQuotes, error)
	SearchStores(ctx context.Context, zipCode string, radiusMiles int) ([]StoreLocation, error)
}

// StoreLocation is one store a user can pick, trimmed to what the chooser
// shows. It lives here rather than in the provider package because it crosses
// the HTTP contract.
type StoreLocation struct {
	LocationID string `json:"locationId"`
	Name       string `json:"name"`
	Chain      string `json:"chain,omitempty"`
	Address    string `json:"address,omitempty"`
	City       string `json:"city,omitempty"`
	State      string `json:"state,omitempty"`
	ZipCode    string `json:"zipCode,omitempty"`
}

// StoreSearch is the answer to a store lookup.
type StoreSearch struct {
	Provider string          `json:"provider"`
	Stores   []StoreLocation `json:"stores"`
}

// StoreProviderStatus tells a client whether real store prices are available at
// all, so it can hide the store chooser instead of offering a dead control.
// This is the feature flag, as seen from outside the service.
type StoreProviderStatus struct {
	Enabled  bool   `json:"enabled"`
	Provider string `json:"provider"`
}

// StoreBasis is the provenance for the store-priced half of an estimate. It
// sits alongside the BLS basis rather than replacing it, because a mixed
// estimate genuinely has two sources.
type StoreBasis struct {
	Provider   string `json:"provider"`
	LocationID string `json:"locationId"`
	StoreName  string `json:"storeName,omitempty"`
	// FetchedAt is RFC 3339. Shelf prices move daily, so the age of the quote is
	// part of the number.
	FetchedAt string `json:"fetchedAt"`
	// PricedCount is how many lines this store actually priced. The rest came
	// from the averages, and saying so is the difference between an honest
	// mixed total and one that implies more precision than it has.
	PricedCount int `json:"pricedCount"`
}

// StoreQueries reduces a list of lines to the distinct lookups a store pricer
// needs, in a stable order. Lines sharing a normalized identity collapse to one
// query, which is what keeps a 30-line list inside a daily call budget.
func (e *Estimator) StoreQueries(lines []Line) []StoreQuery {
	seen := make(map[string]string, len(lines))
	for _, l := range lines {
		key := l.CanonicalItem
		if key == "" {
			key = l.Item
		}
		if key == "" || l.Quantity <= 0 {
			continue
		}
		if _, dup := seen[key]; dup {
			continue
		}
		// Search by the display text where there is one: "whole milk" finds a
		// product, and the canonical id may be a slug no catalogue indexes.
		term := l.Item
		if term == "" {
			term = l.CanonicalItem
		}
		seen[key] = term
	}
	keys := make([]string, 0, len(seen))
	for k := range seen {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	out := make([]StoreQuery, 0, len(keys))
	for _, k := range keys {
		out = append(out, StoreQuery{Key: k, Term: seen[k]})
	}
	return out
}

// EstimateWithStore prices every line it can from the store's quotes and falls
// back to the national averages for the rest. Like Estimate it never errors: a
// store that answered nothing yields exactly the estimate Estimate would have.
func (e *Estimator) EstimateWithStore(lines []Line, quotes StoreQuotes) Estimate {
	return e.estimateWithStoreAt(lines, quotes, time.Now())
}

func (e *Estimator) estimateWithStoreAt(lines []Line, quotes StoreQuotes, now time.Time) Estimate {
	out := e.newEstimate(lines, now)
	basis := StoreBasis{
		Provider:   quotes.Provider,
		LocationID: quotes.LocationID,
		StoreName:  quotes.StoreName,
		FetchedAt:  quotes.FetchedAt.UTC().Format(time.RFC3339),
	}
	for _, l := range lines {
		le, fromStore := e.estimateLineWithStore(l, quotes)
		if fromStore {
			basis.PricedCount++
		}
		e.accumulate(&out, le)
	}
	// A store that priced nothing is not provenance worth showing — the estimate
	// is the plain BLS one, and saying otherwise would be a false attribution.
	if basis.PricedCount > 0 {
		out.Basis.Store = &basis
	}
	return out
}

// estimateLineWithStore prefers the shelf price and falls back to the average.
// The second return reports whether the store is what priced it.
func (e *Estimator) estimateLineWithStore(l Line, quotes StoreQuotes) (LineEstimate, bool) {
	text := l.CanonicalItem
	if text == "" {
		text = l.Item
	}
	quote, ok := quotes.Quotes[text]
	if !ok || l.Quantity <= 0 || quote.PackSize <= 0 || quote.Cents <= 0 {
		return e.estimateLine(l), false
	}

	// The bucket is optional here. It carries the density and per-item weight
	// that bridge dimensions, so without one only a direct conversion works —
	// but a store can price an ingredient no BLS bucket covers, which is one of
	// the things opting in buys.
	key, bucket, matched := e.matcher.Lookup(text)
	baseQty, convertible := e.toSeriesBase(l, bucket, quote.Dimension)
	if !convertible {
		return e.estimateLine(l), false
	}

	le := LineEstimate{
		CanonicalItem: l.CanonicalItem,
		Item:          l.Item,
		Priced:        true,
		Cents:         int(math.Round(baseQty * quote.centsPerBase())),
		Source:        SourceStore,
		Product:       quote.Description,
		OnSale:        quote.OnSale,
	}
	if matched {
		le.Bucket, le.BucketLabel = key, bucket.Label
	}
	return le, true
}
