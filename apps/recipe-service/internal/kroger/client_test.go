package kroger

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"pantry/apps/recipe-service/internal/pricing"
)

// The suite never reaches Kroger. Every response is a fixture recorded from the
// documented shapes and served by an httptest server, so the tests run with no
// credentials, no network, and no daily call budget — which is also the only
// way CI can run them.

type recorder struct {
	mu       sync.Mutex
	paths    []string
	queries  []string
	authzs   []string
	statuses map[string]int
	bodies   map[string]string
	// headers is the Cache-Control (or Expires) each path answers with. Kroger's
	// developer terms bound our cache by exactly this, so it is test input, not
	// scenery.
	headers map[string]map[string]string
}

func newRecorder() *recorder {
	return &recorder{
		statuses: map[string]int{},
		bodies:   map[string]string{},
		headers:  map[string]map[string]string{},
	}
}

func (r *recorder) count(path string) int {
	r.mu.Lock()
	defer r.mu.Unlock()
	n := 0
	for _, p := range r.paths {
		if p == path {
			n++
		}
	}
	return n
}

func fixture(t *testing.T, name string) string {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", name))
	if err != nil {
		t.Fatalf("read fixture %s: %v", name, err)
	}
	return string(raw)
}

// newTestClient serves recorded fixtures from an httptest server and points a
// client at it. Overriding the unexported baseURL is how internal/nutrition's
// FDC tests inject their server too.
func newTestClient(t *testing.T, rec *recorder) *Client {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rec.mu.Lock()
		rec.paths = append(rec.paths, r.URL.Path)
		rec.queries = append(rec.queries, r.URL.RawQuery)
		rec.authzs = append(rec.authzs, r.Header.Get("Authorization"))
		status, hasStatus := rec.statuses[r.URL.Path]
		body, hasBody := rec.bodies[r.URL.Path]
		headers := rec.headers[r.URL.Path]
		rec.mu.Unlock()

		if hasStatus && status != http.StatusOK {
			if status == http.StatusTooManyRequests {
				w.Header().Set("Retry-After", "60")
			}
			w.WriteHeader(status)
			return
		}
		if !hasBody {
			t.Errorf("unexpected request to %s", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		for name, value := range headers {
			w.Header().Set(name, value)
		}
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)

	c := New("test-client-id", "test-client-secret")
	if c == nil {
		t.Fatal("New returned nil for a complete credential pair")
	}
	c.baseURL = srv.URL
	rec.bodies["/connect/oauth2/token"] = fixture(t, "token.json")
	// Most tests are not about caching, so give products a modest cacheable
	// window by default and let the caching tests override it.
	rec.headers["/products"] = map[string]string{"Cache-Control": "max-age=600"}
	return c
}

func TestNewRequiresBothCredentials(t *testing.T) {
	cases := []struct {
		name, id, secret string
	}{
		{"no id", "", "secret"},
		{"no secret", "id", ""},
		{"neither", "", ""},
		{"whitespace only", "  ", "secret"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := New(c.id, c.secret); got != nil {
				t.Errorf("New(%q, %q) = %v, want nil", c.id, c.secret, got)
			}
		})
	}
}

func TestQuotePricesFromTheShelf(t *testing.T) {
	rec := newRecorder()
	c := newTestClient(t, rec)
	rec.bodies["/products"] = fixture(t, "products_milk.json")

	got, err := c.Quote(context.Background(), "01400376", []pricing.StoreQuery{
		{Key: "milk", Term: "whole milk"},
	})
	if err != nil {
		t.Fatalf("Quote: %v", err)
	}

	quote, ok := got.Quotes["milk"]
	if !ok {
		t.Fatalf("no quote for milk, got %v", got.Quotes)
	}
	// The fixture is a $3.99 gallon on promotion at $2.99 — the shopper pays the
	// promotion, and the line says so.
	if quote.Cents != 299 {
		t.Errorf("cents = %d, want 299 (the promo price)", quote.Cents)
	}
	if !quote.OnSale {
		t.Error("onSale = false, want true for a promo below the regular price")
	}
	if quote.Dimension != pricing.DimensionVolume {
		t.Errorf("dimension = %q, want volume for a gallon", quote.Dimension)
	}
	if quote.PackSize != 3785.41 {
		t.Errorf("packSize = %v, want 3785.41 ml", quote.PackSize)
	}
	if quote.Description != "Kroger Vitamin D Whole Milk" {
		t.Errorf("description = %q, want the brand and description joined", quote.Description)
	}
	if got.Provider != ProviderName || got.LocationID != "01400376" {
		t.Errorf("provenance = %q/%q, want kroger/01400376", got.Provider, got.LocationID)
	}
}

func TestQuoteSendsTheLocationAndBearerToken(t *testing.T) {
	rec := newRecorder()
	c := newTestClient(t, rec)
	rec.bodies["/products"] = fixture(t, "products_eggs.json")

	if _, err := c.Quote(context.Background(), "01400376", []pricing.StoreQuery{
		{Key: "eggs", Term: "large eggs"},
	}); err != nil {
		t.Fatalf("Quote: %v", err)
	}

	rec.mu.Lock()
	defer rec.mu.Unlock()
	var query, authz string
	for i, p := range rec.paths {
		if p == "/products" {
			query, authz = rec.queries[i], rec.authzs[i]
		}
	}
	// Without filter.locationId Kroger returns no price at all, which is what
	// makes real prices inherently per-store and inherently opt-in.
	for _, want := range []string{"filter.locationId=01400376", "filter.term=large+eggs", "filter.limit=5"} {
		if !strings.Contains(query, want) {
			t.Errorf("products query %q is missing %q", query, want)
		}
	}
	if !strings.HasPrefix(authz, "Bearer ") {
		t.Errorf("products Authorization = %q, want a bearer token", authz)
	}
	if got := rec.authzs[0]; !strings.HasPrefix(got, "Basic ") {
		t.Errorf("token Authorization = %q, want basic credentials", got)
	}
}

func TestQuoteCachesOnlyAsLongAsTheCacheHeaderAllows(t *testing.T) {
	rec := newRecorder()
	c := newTestClient(t, rec)
	rec.bodies["/products"] = fixture(t, "products_eggs.json")
	rec.headers["/products"] = map[string]string{"Cache-Control": "max-age=600"}
	now := time.Date(2026, 8, 17, 9, 0, 0, 0, time.UTC)
	c.now = func() time.Time { return now }

	queries := []pricing.StoreQuery{{Key: "eggs", Term: "large eggs"}}
	for range 3 {
		if _, err := c.Quote(context.Background(), "01400376", queries); err != nil {
			t.Fatalf("Quote: %v", err)
		}
	}
	if n := rec.count("/products"); n != 1 {
		t.Errorf("lookups inside the cache window = %d, want 1 — the call budget is the point", n)
	}

	// A different store is a different shelf, so it costs its own lookup.
	if _, err := c.Quote(context.Background(), "01400943", queries); err != nil {
		t.Fatalf("Quote: %v", err)
	}
	if n := rec.count("/products"); n != 2 {
		t.Errorf("lookups after a second store = %d, want 2", n)
	}

	// Past max-age the copy may not be kept, which the developer terms require
	// and a moving shelf price wants anyway.
	c.now = func() time.Time { return now.Add(601 * time.Second) }
	if _, err := c.Quote(context.Background(), "01400376", queries); err != nil {
		t.Fatalf("Quote: %v", err)
	}
	if n := rec.count("/products"); n != 3 {
		t.Errorf("lookups after max-age elapsed = %d, want 3", n)
	}
}

// The terms permit keeping a copy only as long as the cache header allows, so a
// response that permits nothing is not kept at all — even though that costs a
// call on every list view.
func TestQuoteDoesNotCacheWhatTheHeaderForbids(t *testing.T) {
	cases := []struct {
		name   string
		header map[string]string
	}{
		{"no cache header at all", map[string]string{}},
		{"no-store", map[string]string{"Cache-Control": "no-store"}},
		{"no-cache", map[string]string{"Cache-Control": "no-cache"}},
		// This cache is shared across every user of the process, so "private"
		// means it is not ours to hold.
		{"private", map[string]string{"Cache-Control": "private, max-age=600"}},
		{"max-age=0", map[string]string{"Cache-Control": "max-age=0"}},
		{"already expired", map[string]string{
			"Date":    "Mon, 17 Aug 2026 09:00:00 GMT",
			"Expires": "Mon, 17 Aug 2026 09:00:00 GMT",
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := newRecorder()
			c := newTestClient(t, rec)
			rec.bodies["/products"] = fixture(t, "products_eggs.json")
			rec.headers["/products"] = tc.header
			c.now = func() time.Time { return time.Date(2026, 8, 17, 9, 0, 0, 0, time.UTC) }

			queries := []pricing.StoreQuery{{Key: "eggs", Term: "large eggs"}}
			for range 3 {
				got, err := c.Quote(context.Background(), "01400376", queries)
				if err != nil {
					t.Fatalf("Quote: %v", err)
				}
				// Not caching costs calls, never correctness: the price is still
				// there on every pass.
				if _, ok := got.Quotes["eggs"]; !ok {
					t.Fatal("no quote returned; not caching must not cost the price")
				}
			}
			if n := rec.count("/products"); n != 3 {
				t.Errorf("lookups = %d, want 3 — this response may not be held", n)
			}
		})
	}
}

func TestQuoteCachesMissesToo(t *testing.T) {
	rec := newRecorder()
	c := newTestClient(t, rec)
	rec.bodies["/products"] = fixture(t, "products_empty.json")

	queries := []pricing.StoreQuery{{Key: "sumac", Term: "sumac"}}
	for range 3 {
		got, err := c.Quote(context.Background(), "01400376", queries)
		if err != nil {
			t.Fatalf("Quote: %v", err)
		}
		if len(got.Quotes) != 0 {
			t.Fatalf("quotes = %v, want none for an item the store does not carry", got.Quotes)
		}
	}
	// A miss is as much a property of that response as a price is, so it is held
	// on the same terms. Re-asking inside the window would spend the call budget
	// learning the same thing over and over.
	if n := rec.count("/products"); n != 1 {
		t.Errorf("lookups for an uncarried item = %d, want 1", n)
	}
}

func TestQuoteSkipsProductsItCannotPriceHonestly(t *testing.T) {
	rec := newRecorder()
	c := newTestClient(t, rec)
	rec.bodies["/products"] = fixture(t, "products_unpriceable.json")

	got, err := c.Quote(context.Background(), "01400376", []pricing.StoreQuery{
		{Key: "saffron", Term: "saffron"},
	})
	if err != nil {
		t.Fatalf("Quote: %v", err)
	}
	// One candidate has no price at this store, the other a pack size nothing
	// can be converted from. Guessing either produces confidently wrong money.
	if len(got.Quotes) != 0 {
		t.Errorf("quotes = %v, want none", got.Quotes)
	}
}

func TestQuoteDegradesWhenTheSearchFails(t *testing.T) {
	rec := newRecorder()
	c := newTestClient(t, rec)
	rec.statuses["/products"] = http.StatusInternalServerError

	got, err := c.Quote(context.Background(), "01400376", []pricing.StoreQuery{
		{Key: "milk", Term: "whole milk"},
	})
	// No error and no quotes: the caller cannot tell an unreachable retailer
	// from a store that carries nothing, and neither breaks the grocery list.
	if err != nil {
		t.Errorf("Quote returned %v, want nil so the list still prices", err)
	}
	if len(got.Quotes) != 0 {
		t.Errorf("quotes = %v, want none", got.Quotes)
	}
}

func TestQuoteDegradesWhenTheTokenCannotBeFetched(t *testing.T) {
	rec := newRecorder()
	c := newTestClient(t, rec)
	rec.statuses["/connect/oauth2/token"] = http.StatusUnauthorized

	got, err := c.Quote(context.Background(), "01400376", []pricing.StoreQuery{
		{Key: "milk", Term: "whole milk"},
	})
	if err != nil {
		t.Errorf("Quote returned %v, want nil — bad credentials degrade, they do not fail", err)
	}
	if len(got.Quotes) != 0 {
		t.Errorf("quotes = %v, want none", got.Quotes)
	}
}

func TestQuoteStopsAfterARateLimit(t *testing.T) {
	rec := newRecorder()
	c := newTestClient(t, rec)
	rec.statuses["/products"] = http.StatusTooManyRequests
	now := time.Date(2026, 8, 17, 9, 0, 0, 0, time.UTC)
	c.now = func() time.Time { return now }

	if _, err := c.Quote(context.Background(), "01400376", []pricing.StoreQuery{
		{Key: "milk", Term: "whole milk"},
	}); !errors.Is(err, errRateLimited) {
		t.Fatalf("Quote error = %v, want errRateLimited", err)
	}

	before := rec.count("/products")
	if _, err := c.Quote(context.Background(), "01400376", []pricing.StoreQuery{
		{Key: "eggs", Term: "large eggs"},
	}); !errors.Is(err, errRateLimited) {
		t.Fatalf("second Quote error = %v, want errRateLimited", err)
	}
	// Inside the cooldown nothing goes out: the Retry-After was 60s.
	if got := rec.count("/products"); got != before {
		t.Errorf("lookups during the cooldown = %d, want %d", got, before)
	}
}

func TestQuoteRequiresAStore(t *testing.T) {
	rec := newRecorder()
	c := newTestClient(t, rec)

	if _, err := c.Quote(context.Background(), "  ", nil); err == nil {
		t.Error("Quote with no locationId succeeded, want an error")
	}
	if rec.count("/products") != 0 {
		t.Error("Quote with no locationId reached the API")
	}
}

func TestQuoteHonoursTheLookupBudget(t *testing.T) {
	rec := newRecorder()
	c := newTestClient(t, rec)
	rec.bodies["/products"] = fixture(t, "products_eggs.json")

	queries := make([]pricing.StoreQuery, 0, maxLookupsPerQuote+5)
	for i := range maxLookupsPerQuote + 5 {
		key := string(rune('a'+i%26)) + string(rune('a'+i/26))
		queries = append(queries, pricing.StoreQuery{Key: key, Term: key})
	}
	if _, err := c.Quote(context.Background(), "01400376", queries); err != nil {
		t.Fatalf("Quote: %v", err)
	}
	if n := rec.count("/products"); n != maxLookupsPerQuote {
		t.Errorf("lookups = %d, want the budget of %d", n, maxLookupsPerQuote)
	}
}

func TestSearchStores(t *testing.T) {
	rec := newRecorder()
	c := newTestClient(t, rec)
	rec.bodies["/locations"] = fixture(t, "locations_45202.json")

	got, err := c.SearchStores(context.Background(), "45202", 0)
	if err != nil {
		t.Fatalf("SearchStores: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("stores = %d, want 2", len(got))
	}
	if got[0].LocationID != "01400376" || got[0].Name != "Corryville" {
		t.Errorf("first store = %+v, want the Corryville location", got[0])
	}
	// The second fixture store has no name; a blank row next to a radio button
	// is not a choice anyone can make.
	if got[1].Name != "Cincinnati" {
		t.Errorf("unnamed store fell back to %q, want its city", got[1].Name)
	}

	rec.mu.Lock()
	defer rec.mu.Unlock()
	for i, p := range rec.paths {
		if p != "/locations" {
			continue
		}
		for _, want := range []string{"filter.zipCode.near=45202", "filter.radiusInMiles=10"} {
			if !strings.Contains(rec.queries[i], want) {
				t.Errorf("locations query %q is missing %q (the default radius)", rec.queries[i], want)
			}
		}
	}
}

func TestSearchStoresWithoutAZipDoesNotCall(t *testing.T) {
	rec := newRecorder()
	c := newTestClient(t, rec)

	got, err := c.SearchStores(context.Background(), "   ", 10)
	if err != nil || got != nil {
		t.Errorf("SearchStores(blank) = %v, %v; want nil, nil", got, err)
	}
	if rec.count("/locations") != 0 {
		t.Error("a blank zip reached the API")
	}
}

func TestSearchStoresReportsFailure(t *testing.T) {
	rec := newRecorder()
	c := newTestClient(t, rec)
	rec.statuses["/locations"] = http.StatusBadGateway

	// Unlike pricing a list, this answers a deliberate user action with its own
	// screen, so an empty list would read as "no stores near you".
	if _, err := c.SearchStores(context.Background(), "45202", 10); err == nil {
		t.Error("SearchStores succeeded against a failing directory, want an error")
	}
}

func TestAccessTokenIsReusedUntilItNearlyExpires(t *testing.T) {
	rec := newRecorder()
	c := newTestClient(t, rec)
	rec.bodies["/products"] = fixture(t, "products_eggs.json")
	now := time.Date(2026, 8, 17, 9, 0, 0, 0, time.UTC)
	c.now = func() time.Time { return now }

	for i := range 3 {
		if _, err := c.Quote(context.Background(), "01400376", []pricing.StoreQuery{
			{Key: "eggs" + string(rune('a'+i)), Term: "large eggs"},
		}); err != nil {
			t.Fatalf("Quote: %v", err)
		}
	}
	if n := rec.count("/connect/oauth2/token"); n != 1 {
		t.Errorf("token fetches = %d, want 1 — the fixture token lasts 30 minutes", n)
	}

	// The fixture expires_in is 1800s and the client renews a minute early.
	c.now = func() time.Time { return now.Add(1799 * time.Second) }
	if _, err := c.Quote(context.Background(), "01400376", []pricing.StoreQuery{
		{Key: "butter", Term: "butter"},
	}); err != nil {
		t.Fatalf("Quote: %v", err)
	}
	if n := rec.count("/connect/oauth2/token"); n != 2 {
		t.Errorf("token fetches after expiry = %d, want 2", n)
	}
}

func TestShelfCents(t *testing.T) {
	cases := []struct {
		name             string
		regular, promo   float64
		wantCents        int
		wantSale, wantOK bool
	}{
		{"promo below regular wins", 3.99, 2.99, 299, true, true},
		{"no promo", 4.29, 0, 429, false, true},
		{"promo at the regular price is not a sale", 4.29, 4.29, 429, false, true},
		{"promo above regular is not a sale", 4.29, 5.00, 429, false, true},
		{"no price at this store", 0, 0, 0, false, false},
		{"rounds to the cent", 1.239, 0, 124, false, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			cents, sale, ok := shelfCents(c.regular, c.promo)
			if cents != c.wantCents || sale != c.wantSale || ok != c.wantOK {
				t.Errorf("shelfCents(%v, %v) = %d, %v, %v; want %d, %v, %v",
					c.regular, c.promo, cents, sale, ok, c.wantCents, c.wantSale, c.wantOK)
			}
		})
	}
}

func TestDescribe(t *testing.T) {
	cases := []struct {
		name, brand, desc, want string
	}{
		{"brand prefixed", "Kroger", "Vitamin D Whole Milk", "Kroger Vitamin D Whole Milk"},
		{"brand already leads", "Kroger", "Kroger Whole Milk", "Kroger Whole Milk"},
		{"no brand", "", "Store Brand Milk", "Store Brand Milk"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := describe(product{Brand: c.brand, Description: c.desc}); got != c.want {
				t.Errorf("describe = %q, want %q", got, c.want)
			}
		})
	}
}

// cacheTTL is where the developer terms' caching rule actually lives, so it is
// tested directly rather than only through Quote.
func TestCacheTTL(t *testing.T) {
	now := time.Date(2026, 8, 17, 9, 0, 0, 0, time.UTC)
	cases := []struct {
		name   string
		header http.Header
		want   time.Duration
	}{
		{"max-age", http.Header{"Cache-Control": {"max-age=600"}}, 10 * time.Minute},
		{"max-age with other directives", http.Header{"Cache-Control": {"public, max-age=300"}}, 5 * time.Minute},
		{"quoted value", http.Header{"Cache-Control": {`max-age="300"`}}, 5 * time.Minute},
		{"uppercase", http.Header{"Cache-Control": {"MAX-AGE=300"}}, 5 * time.Minute},
		// s-maxage is the directive addressed to a shared cache, and this is one.
		{"s-maxage wins", http.Header{"Cache-Control": {"max-age=600, s-maxage=60"}}, time.Minute},
		{"expires", http.Header{
			"Date":    {"Mon, 17 Aug 2026 09:00:00 GMT"},
			"Expires": {"Mon, 17 Aug 2026 09:05:00 GMT"},
		}, 5 * time.Minute},
		// Cache-Control outranks Expires, so a no-store next to a future Expires
		// still permits nothing.
		{"no-store beats expires", http.Header{
			"Cache-Control": {"no-store"},
			"Expires":       {"Mon, 17 Aug 2026 23:00:00 GMT"},
		}, 0},
		// A year-long max-age would be a permanent copy in all but name, which
		// the terms prohibit outright.
		{"capped", http.Header{"Cache-Control": {"max-age=31536000"}}, maxCacheTTL},
		{"nothing", http.Header{}, 0},
		{"unparsable max-age", http.Header{"Cache-Control": {"max-age=soon"}}, 0},
		{"unparsable expires", http.Header{"Expires": {"soon"}}, 0},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := cacheTTL(c.header, now); got != c.want {
				t.Errorf("cacheTTL = %v, want %v", got, c.want)
			}
		})
	}
}
