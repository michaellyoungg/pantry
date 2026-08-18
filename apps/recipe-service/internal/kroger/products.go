package kroger

import (
	"context"
	"errors"
	"log/slog"
	"math"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"pantry/apps/recipe-service/internal/pricing"
)

// productSearch is the slice of GET /products this package reads. Kroger
// returns considerably more; decoding only what is used keeps an upstream
// addition from being a compile-time event.
type productSearch struct {
	Data []product `json:"data"`
}

type product struct {
	ProductID   string        `json:"productId"`
	Description string        `json:"description"`
	Brand       string        `json:"brand"`
	Items       []productItem `json:"items"`
}

type productItem struct {
	Size  string `json:"size"`
	Price *struct {
		Regular float64 `json:"regular"`
		Promo   float64 `json:"promo"`
	} `json:"price"`
}

// quoteConcurrency bounds how many product searches are in flight at once. One
// grocery list is one user waiting on a page, so the lookups run in parallel;
// six is enough to keep a cold list inside a request timeout without becoming a
// burst the retailer would see as abuse.
const quoteConcurrency = 6

// Quote prices as many of the requested ingredients as it can at one store.
//
// Every failure mode below degrades to a smaller answer: a rate limit stops the
// batch, a search error skips the term, an item with no price or an unparsable
// pack size is cached as a miss. The caller layers whatever comes back over the
// national averages, so an empty answer is indistinguishable from not having
// opted in.
func (c *Client) Quote(
	ctx context.Context, locationID string, queries []pricing.StoreQuery,
) (pricing.StoreQuotes, error) {
	out := pricing.StoreQuotes{
		Provider:   ProviderName,
		LocationID: strings.TrimSpace(locationID),
		FetchedAt:  c.now(),
		Quotes:     map[string]pricing.StoreQuote{},
	}
	if out.LocationID == "" {
		return out, errors.New("kroger: a store locationId is required to price")
	}
	if c.cooling() {
		return out, errRateLimited
	}

	pending := make([]pricing.StoreQuery, 0, len(queries))
	for _, q := range queries {
		if entry, ok := c.cached(out.LocationID, q.Key); ok {
			if entry.found {
				out.Quotes[q.Key] = entry.quote
			}
			continue
		}
		if len(pending) >= maxLookupsPerQuote {
			// Silently truncating would read as "your store doesn't carry these".
			slog.Info("kroger: lookup budget reached for this list",
				"budget", maxLookupsPerQuote, "requested", len(queries))
			break
		}
		pending = append(pending, q)
	}
	if len(pending) == 0 {
		return out, nil
	}

	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	var (
		mu       sync.Mutex
		wg       sync.WaitGroup
		limiter  = make(chan struct{}, quoteConcurrency)
		limitHit bool
	)
	for _, q := range pending {
		wg.Add(1)
		go func(q pricing.StoreQuery) {
			defer wg.Done()
			limiter <- struct{}{}
			defer func() { <-limiter }()

			quote, found, ttl, err := c.searchOne(ctx, out.LocationID, q.Term)
			switch {
			case errors.Is(err, errRateLimited):
				mu.Lock()
				limitHit = true
				mu.Unlock()
				// Stop the rest of the batch rather than run every remaining term
				// into the same wall.
				cancel()
				return
			case err != nil:
				if ctx.Err() == nil {
					slog.Warn("kroger: product lookup failed; line falls back to the average",
						"term", q.Term, "err", err)
				}
				return
			}
			c.putCache(out.LocationID, q.Key, cacheEntry{quote: quote, found: found}, ttl)
			if !found {
				return
			}
			mu.Lock()
			out.Quotes[q.Key] = quote
			mu.Unlock()
		}(q)
	}
	wg.Wait()

	if limitHit {
		return out, errRateLimited
	}
	return out, nil
}

// searchOne resolves one search term to the best usable shelf price at a store.
// The returned duration is how long that answer may be cached, straight from
// the response's own cache headers; zero means it may not be.
func (c *Client) searchOne(
	ctx context.Context, locationID, term string,
) (pricing.StoreQuote, bool, time.Duration, error) {
	term = strings.TrimSpace(term)
	if term == "" {
		return pricing.StoreQuote{}, false, 0, nil
	}
	query := url.Values{
		"filter.term":       {term},
		"filter.locationId": {locationID},
		"filter.limit":      {strconv.Itoa(productsPerTerm)},
	}
	var body productSearch
	header, err := c.get(ctx, "/products", query, &body)
	if err != nil {
		return pricing.StoreQuote{}, false, 0, err
	}
	ttl := cacheTTL(header, c.now())
	for _, p := range body.Data {
		if q, ok := quoteFrom(p); ok {
			return q, true, ttl, nil
		}
	}
	// No error: the store genuinely carries nothing priceable for this term.
	return pricing.StoreQuote{}, false, ttl, nil
}

// quoteFrom reduces a product to a comparable price, or reports that it cannot.
// A product is usable only when it has both a price at this store and a pack
// size in a dimension a recipe quantity can be converted into.
func quoteFrom(p product) (pricing.StoreQuote, bool) {
	for _, item := range p.Items {
		if item.Price == nil {
			continue
		}
		cents, onSale, ok := shelfCents(item.Price.Regular, item.Price.Promo)
		if !ok {
			continue
		}
		dim, packSize, ok := pricing.ParsePackSize(item.Size)
		if !ok {
			continue
		}
		return pricing.StoreQuote{
			Description: describe(p),
			Cents:       cents,
			Dimension:   dim,
			PackSize:    packSize,
			OnSale:      onSale,
		}, true
	}
	return pricing.StoreQuote{}, false
}

// shelfCents picks what the shopper would actually pay. Kroger sends promo=0
// when there is no promotion, and occasionally a promo at or above the regular
// price, which is not a sale.
func shelfCents(regular, promo float64) (cents int, onSale bool, ok bool) {
	if promo > 0 && promo < regular {
		return int(math.Round(promo * 100)), true, true
	}
	if regular > 0 {
		return int(math.Round(regular * 100)), false, true
	}
	return 0, false, false
}

// describe names the product the way a shelf tag would, so a price can be shown
// as the price of something specific.
func describe(p product) string {
	desc := strings.TrimSpace(p.Description)
	brand := strings.TrimSpace(p.Brand)
	if brand == "" || strings.HasPrefix(strings.ToLower(desc), strings.ToLower(brand)) {
		return desc
	}
	return brand + " " + desc
}
