// Package kroger reads real shelf prices from the Kroger Products API, as the
// first implementation of pricing.StorePricer (BL-0046).
//
// Everything here is opt-in twice over. The service constructs a client only
// when both the feature flag and OAuth2 credentials are present, and a client
// only quotes a store the user chose — Kroger returns no price at all without a
// locationId, so there is no such thing as an accidental store price.
//
// Its contract to the caller is that it degrades rather than fails: a missing
// token, an unreachable API, a rate limit, a product with no price at that
// store, or a pack size it cannot parse all produce fewer quotes, never an
// error the grocery list can trip over. The national averages in
// internal/pricing cover whatever comes back empty.
//
// Caching here is bounded by Kroger's developer terms, which prohibit building
// databases or permanent copies of API content and keeping "cached copies
// longer than permitted by the cache header". So the cache is in-process only —
// nothing reaches Postgres or Convex — and every entry's lifetime comes from
// the response's own Cache-Control/Expires headers. A response that carries no
// cache header, or forbids shared caching, is not cached at all.
package kroger

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"pantry/apps/recipe-service/internal/pricing"
)

// DefaultBaseURL is the Kroger public API root.
const DefaultBaseURL = "https://api.kroger.com/v1"

// ProviderName is what the UI shows and what a stored store selection is
// tagged with, so a second provider later cannot be mistaken for this one.
const ProviderName = "kroger"

// productScope is the only scope the public Products and Locations APIs need.
// It is client-credentials, not a user grant: no shopper account is involved.
const productScope = "product.compact"

const (
	// maxLookupsPerQuote bounds one grocery list to a fixed slice of the daily
	// call budget. Kroger allows ~10,000 Products calls a day; a 30-line list
	// looked up once per store per day leaves room for hundreds of shoppers.
	maxLookupsPerQuote = 30
	// productsPerTerm is how many candidates to consider per search. The first
	// result with a usable price and pack size wins, and asking for a handful
	// costs the same one call as asking for one.
	productsPerTerm = 5
	// maxCacheEntries bounds the price cache. Reaching it means an unusual
	// number of distinct (store, ingredient) pairs still live at once; dropping
	// the expired half is cheaper than unbounded growth in a long-lived process.
	maxCacheEntries = 5000
	// maxCacheTTL caps how long an entry is held no matter how generous the
	// response's cache header is. A very long max-age would otherwise turn this
	// into the "permanent copy" the developer terms prohibit, and a shelf price
	// a day old is not worth showing anyway.
	maxCacheTTL = 24 * time.Hour
	// rateLimitCooldown is how long to stop asking after a 429. The daily quota
	// resets at midnight, but a shorter pause is enough to stop a burst, and
	// every paused request simply falls back to the averages.
	rateLimitCooldown = 30 * time.Minute
	// requestTimeout keeps a slow retailer from holding a grocery-list request
	// open. Pricing is decoration; it does not get to be slow.
	requestTimeout = 8 * time.Second
)

// Client talks to the Kroger API on behalf of the service. It is safe for
// concurrent use; the mutex guards the access token and the price cache.
type Client struct {
	clientID     string
	clientSecret string
	baseURL      string
	http         *http.Client
	now          func() time.Time

	mu             sync.Mutex
	token          string
	tokenExpiry    time.Time
	cache          map[string]cacheEntry
	rateLimitedTil time.Time
}

// cacheEntry is one answer for one (store, ingredient) pair, held only until
// the response's own cache header says it may no longer be. Misses are cached
// on the same terms: an ingredient the catalogue does not carry is as much a
// property of that response as a price is.
type cacheEntry struct {
	quote     pricing.StoreQuote
	found     bool
	expiresAt time.Time
}

var _ pricing.StorePricer = (*Client)(nil)

// New returns a client, or nil when either credential is missing. A nil client
// is the caller's cue that real store prices are not configured — the same
// shape internal/nutrition's FDC provider uses.
//
// Credentials come from the environment only. Nothing here reads a file and
// nothing is compiled in, so there is no path by which a key reaches the repo.
func New(clientID, clientSecret string) *Client {
	if strings.TrimSpace(clientID) == "" || strings.TrimSpace(clientSecret) == "" {
		return nil
	}
	return &Client{
		clientID:     strings.TrimSpace(clientID),
		clientSecret: strings.TrimSpace(clientSecret),
		baseURL:      DefaultBaseURL,
		http:         &http.Client{Timeout: requestTimeout},
		now:          time.Now,
		cache:        map[string]cacheEntry{},
	}
}

// Provider identifies this pricer in stored selections and in the UI.
func (c *Client) Provider() string { return ProviderName }

// accessToken returns a cached client-credentials token, fetching a new one
// when the current one is missing or close to expiry.
func (c *Client) accessToken(ctx context.Context) (string, error) {
	c.mu.Lock()
	// A 60s margin: a token that expires mid-flight would fail a request that
	// looked valid when it was picked up.
	if c.token != "" && c.now().Add(time.Minute).Before(c.tokenExpiry) {
		tok := c.token
		c.mu.Unlock()
		return tok, nil
	}
	c.mu.Unlock()

	form := url.Values{"grant_type": {"client_credentials"}, "scope": {productScope}}
	req, err := http.NewRequestWithContext(
		ctx, http.MethodPost, c.baseURL+"/connect/oauth2/token", strings.NewReader(form.Encode()),
	)
	if err != nil {
		return "", err
	}
	basic := base64.StdEncoding.EncodeToString([]byte(c.clientID + ":" + c.clientSecret))
	req.Header.Set("Authorization", "Basic "+basic)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := c.http.Do(req)
	if err != nil {
		return "", fmt.Errorf("kroger token: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		// Deliberately does not include the body: a token error can echo the
		// credential back, and this string reaches the logs.
		return "", fmt.Errorf("kroger token: unexpected status %d", resp.StatusCode)
	}
	var body struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return "", fmt.Errorf("kroger token: decode: %w", err)
	}
	if body.AccessToken == "" {
		return "", fmt.Errorf("kroger token: response carried no access_token")
	}

	c.mu.Lock()
	c.token = body.AccessToken
	c.tokenExpiry = c.now().Add(time.Duration(body.ExpiresIn) * time.Second)
	c.mu.Unlock()
	return body.AccessToken, nil
}

// get performs an authenticated GET and decodes the JSON body into dst. It
// returns the response headers so the caller can read how long, if at all, the
// answer may be cached.
func (c *Client) get(
	ctx context.Context, path string, query url.Values, dst any,
) (http.Header, error) {
	token, err := c.accessToken(ctx)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+path+"?"+query.Encode(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("kroger %s: %w", path, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusTooManyRequests {
		c.enterCooldown(resp.Header.Get("Retry-After"))
		return nil, errRateLimited
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("kroger %s: unexpected status %d", path, resp.StatusCode)
	}
	if err := json.NewDecoder(resp.Body).Decode(dst); err != nil {
		return nil, fmt.Errorf("kroger %s: decode: %w", path, err)
	}
	return resp.Header, nil
}

// cacheTTL reads how long a response may be held from its own cache headers,
// returning zero when it may not be held at all.
//
// This is the developer terms' caching rule expressed as code: nothing is kept
// "longer than permitted by the cache header", and a response that permits
// nothing — no header, no-store, no-cache, or private, since this cache is
// shared across every user of the process — is not stored.
func cacheTTL(h http.Header, now time.Time) time.Duration {
	control := h.Get("Cache-Control")
	var maxAge time.Duration
	seenMaxAge := false

	for _, directive := range strings.Split(control, ",") {
		name, value, _ := strings.Cut(strings.TrimSpace(strings.ToLower(directive)), "=")
		switch name {
		case "no-store", "no-cache", "private":
			return 0
		case "max-age", "s-maxage":
			secs, err := strconv.Atoi(strings.Trim(value, `"`))
			if err != nil || secs <= 0 {
				return 0
			}
			// s-maxage overrides max-age for a shared cache, and this is one.
			if name == "s-maxage" || !seenMaxAge {
				maxAge = time.Duration(secs) * time.Second
			}
			if name == "s-maxage" {
				return clampTTL(maxAge)
			}
			seenMaxAge = true
		}
	}
	if seenMaxAge {
		return clampTTL(maxAge)
	}

	// No Cache-Control: fall back to Expires, dated against the server's own
	// clock where it sent one, so our clock skew cannot extend the window.
	expires, err := http.ParseTime(h.Get("Expires"))
	if err != nil {
		return 0
	}
	from := now
	if date, err := http.ParseTime(h.Get("Date")); err == nil {
		from = date
	}
	return clampTTL(expires.Sub(from))
}

func clampTTL(ttl time.Duration) time.Duration {
	if ttl <= 0 {
		return 0
	}
	return min(ttl, maxCacheTTL)
}

// errRateLimited marks the one failure that should stop a batch early rather
// than retrying every remaining term into the same wall.
var errRateLimited = fmt.Errorf("kroger: rate limited")

func (c *Client) enterCooldown(retryAfter string) {
	cooldown := rateLimitCooldown
	if secs, err := strconv.Atoi(strings.TrimSpace(retryAfter)); err == nil && secs > 0 {
		cooldown = time.Duration(secs) * time.Second
	}
	c.mu.Lock()
	c.rateLimitedTil = c.now().Add(cooldown)
	c.mu.Unlock()
	slog.Warn("kroger: rate limited; store prices fall back to averages",
		"cooldown", cooldown.String())
}

func (c *Client) cooling() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now().Before(c.rateLimitedTil)
}

func cacheKey(locationID, itemKey string) string { return locationID + "\x00" + itemKey }

func (c *Client) cached(locationID, itemKey string) (cacheEntry, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.cache[cacheKey(locationID, itemKey)]
	if !ok || !c.now().Before(e.expiresAt) {
		return cacheEntry{}, false
	}
	return e, true
}

// putCache stores an answer for ttl, or not at all when the response's cache
// header permitted nothing. Not caching is always safe: it costs calls against
// the daily budget, never correctness.
func (c *Client) putCache(locationID, itemKey string, e cacheEntry, ttl time.Duration) {
	if ttl <= 0 {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	e.expiresAt = c.now().Add(ttl)
	if len(c.cache) >= maxCacheEntries {
		now := c.now()
		for k, v := range c.cache {
			if !now.Before(v.expiresAt) {
				delete(c.cache, k)
			}
		}
		// Still full means live entries alone overflowed it. Start over rather
		// than grow without bound; the cost is repeated lookups, not wrong prices.
		if len(c.cache) >= maxCacheEntries {
			c.cache = map[string]cacheEntry{}
		}
	}
	c.cache[cacheKey(locationID, itemKey)] = e
}
