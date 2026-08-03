package nutrition

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

// DefaultFDCBaseURL is USDA FoodData Central's v1 API root.
const DefaultFDCBaseURL = "https://api.nal.usda.gov/fdc/v1"

// defaultRateLimitCooldown is how long we stop asking after a 429 when the
// response carries no Retry-After. FDC's quota is per hour, but backing off for
// the full hour on a single burst is heavier than needed; cached ingredients are
// unaffected either way.
const defaultRateLimitCooldown = 15 * time.Minute

// FDCProvider looks ingredients up in USDA FoodData Central.
//
// It is the only part of this package that touches the network, and nothing
// depends on it: the snapshot seed and the fake provider cover tests and offline
// development, so a missing key costs coverage, never correctness.
type FDCProvider struct {
	apiKey  string
	baseURL string
	client  *http.Client
	now     func() time.Time

	mu             sync.Mutex
	rateLimitedTil time.Time
}

// NewFDCProvider returns a live provider, or nil if apiKey is empty. A nil
// return is the caller's cue to fall back to the snapshot alone.
func NewFDCProvider(apiKey string) *FDCProvider {
	if strings.TrimSpace(apiKey) == "" {
		return nil
	}
	return &FDCProvider{
		apiKey:  apiKey,
		baseURL: DefaultFDCBaseURL,
		// Nutrition is a supporting panel on a recipe page; it must not be able
		// to hold an HTTP handler open for minutes.
		client: &http.Client{Timeout: 10 * time.Second},
		now:    time.Now,
	}
}

// Lookup searches FDC for the canonical ingredient, picks the best match, and
// fetches its full record for the portion weights — search results do not carry
// foodPortions, and portions are the entire reason this data source was chosen.
func (p *FDCProvider) Lookup(ctx context.Context, canonicalItem string) (Food, bool, error) {
	query := strings.TrimSpace(canonicalItem)
	if query == "" {
		return Food{}, false, nil
	}
	p.mu.Lock()
	limited := p.now().Before(p.rateLimitedTil)
	p.mu.Unlock()
	if limited {
		// Degrade to "unresolved" for the rest of the window rather than erroring.
		return Food{}, false, nil
	}

	hits, err := p.search(ctx, query)
	if err != nil {
		return Food{}, false, err
	}
	best, confidence, ok := bestMatch(query, hits)
	if !ok {
		return Food{}, false, nil
	}

	detail, err := p.food(ctx, best.FDCID)
	if err != nil {
		return Food{}, false, err
	}
	food := detail.toFood()
	food.MatchConfidence = confidence
	return food, true, nil
}

type fdcSearchHit struct {
	FDCID       int     `json:"fdcId"`
	Description string  `json:"description"`
	DataType    string  `json:"dataType"`
	Score       float64 `json:"score"`
}

func (p *FDCProvider) search(ctx context.Context, query string) ([]fdcSearchHit, error) {
	q := url.Values{
		"api_key":  {p.apiKey},
		"query":    {query},
		"pageSize": {"10"},
		// Foundation and SR Legacy are generic whole foods with curated
		// portions. Branded entries are specific products with none of the
		// household measures the resolver needs.
		"dataType": {"Foundation,SR Legacy"},
	}
	var body struct {
		Foods []fdcSearchHit `json:"foods"`
	}
	if err := p.get(ctx, "/foods/search?"+q.Encode(), &body); err != nil {
		return nil, err
	}
	return body.Foods, nil
}

// fdcFood is the full record. Search and detail responses shape nutrients
// differently, so only this one is parsed.
type fdcFood struct {
	FDCID         int    `json:"fdcId"`
	Description   string `json:"description"`
	FoodNutrients []struct {
		Nutrient struct {
			ID       int    `json:"id"`
			Name     string `json:"name"`
			UnitName string `json:"unitName"`
		} `json:"nutrient"`
		Amount float64 `json:"amount"`
	} `json:"foodNutrients"`
	FoodPortions []struct {
		Amount             float64 `json:"amount"`
		GramWeight         float64 `json:"gramWeight"`
		Modifier           string  `json:"modifier"`
		PortionDescription string  `json:"portionDescription"`
		MeasureUnit        struct {
			Name string `json:"name"`
		} `json:"measureUnit"`
	} `json:"foodPortions"`
}

func (p *FDCProvider) food(ctx context.Context, fdcID int) (fdcFood, error) {
	q := url.Values{"api_key": {p.apiKey}, "format": {"full"}}
	var body fdcFood
	err := p.get(ctx, "/food/"+strconv.Itoa(fdcID)+"?"+q.Encode(), &body)
	return body, err
}

func (p *FDCProvider) get(ctx context.Context, path string, dst any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, p.baseURL+path, nil)
	if err != nil {
		return err
	}
	resp, err := p.client.Do(req)
	if err != nil {
		return fmt.Errorf("fdc request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusTooManyRequests {
		p.enterCooldown(resp.Header.Get("Retry-After"))
		return nil // dst stays zero: no hits, no error
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("fdc %s: unexpected status %d", path, resp.StatusCode)
	}
	if err := json.NewDecoder(resp.Body).Decode(dst); err != nil {
		return fmt.Errorf("fdc %s: decode: %w", path, err)
	}
	return nil
}

func (p *FDCProvider) enterCooldown(retryAfter string) {
	cooldown := defaultRateLimitCooldown
	if secs, err := strconv.Atoi(strings.TrimSpace(retryAfter)); err == nil && secs > 0 {
		cooldown = time.Duration(secs) * time.Second
	}
	p.mu.Lock()
	p.rateLimitedTil = p.now().Add(cooldown)
	p.mu.Unlock()
	slog.Warn("nutrition: FDC rate limit reached; lookups degrade to unresolved",
		"cooldown", cooldown.String())
}

// toFood maps a full FDC record onto our storage shape: an open nutrient map
// keyed by FDC nutrient number, and portions keyed by normalized measure.
func (f fdcFood) toFood() Food {
	food := Food{
		FDCID:       f.FDCID,
		Description: f.Description,
		Nutrients:   map[string]float64{},
		Portions:    map[string]float64{},
		Source:      SourceFDC,
	}
	for _, n := range f.FoodNutrients {
		if n.Nutrient.ID == 0 {
			continue
		}
		food.Nutrients[strconv.Itoa(n.Nutrient.ID)] = n.Amount
	}
	for _, portion := range f.FoodPortions {
		if portion.GramWeight <= 0 {
			continue
		}
		key := portionKeyOf(portion.MeasureUnit.Name, portion.Modifier, portion.PortionDescription)
		if key == "" {
			continue
		}
		// gramWeight is for `amount` of the measure, not one of it.
		amount := portion.Amount
		if amount <= 0 {
			amount = 1
		}
		// Rounded because the division reintroduces float noise into a number
		// that is then multiplied by every recipe quantity that uses it.
		per := round(portion.GramWeight/amount, 4)
		// FDC publishes several rows per measure ("cup, chopped", "cup, sliced").
		// First one wins so the value is stable across refreshes.
		if _, taken := food.Portions[key]; !taken {
			food.Portions[key] = per
		}
	}
	return food
}

// portionKeyOf picks a usable measure from the three places FDC hides one.
// measureUnit.name is often the literal string "undetermined", in which case the
// real measure is in the modifier or the free-text description.
func portionKeyOf(measureUnit, modifier, description string) string {
	for _, candidate := range []string{measureUnit, modifier, description} {
		if k := portionKey(candidate); k != "" {
			return k
		}
	}
	return ""
}

// bestMatch picks the FDC hit most likely to be the ingredient asked for.
//
// The matcher is deliberately simple. Fuzzy matching over two million foods
// cannot be made reliable by tuning, so the design's answer is a reviewable
// mapping table: this picks a plausible default and records a confidence, and a
// wrong pick is fixed by editing one row.
func bestMatch(query string, hits []fdcSearchHit) (fdcSearchHit, float64, bool) {
	best, bestScore := fdcSearchHit{}, 0.0
	for _, h := range hits {
		if s := matchConfidence(query, h.Description, h.DataType); s > bestScore {
			best, bestScore = h, s
		}
	}
	if bestScore == 0 {
		return fdcSearchHit{}, 0, false
	}
	return best, bestScore, true
}

// matchConfidence scores a candidate description against the ingredient text.
// FDC descriptions lead with the food and qualify after a comma — "Garlic, raw",
// "Onions, spring or scallions, raw" — so the head is what actually names it.
func matchConfidence(query, description, dataType string) float64 {
	q := strings.ToLower(strings.TrimSpace(query))
	d := strings.ToLower(strings.TrimSpace(description))
	if q == "" || d == "" {
		return 0
	}
	head := d
	if i := strings.IndexByte(head, ','); i >= 0 {
		head = strings.TrimSpace(head[:i])
	}

	var score float64
	switch {
	case head == q:
		score = 0.95
	case containsWord(head, q):
		score = 0.8
	case containsWord(d, q):
		score = 0.65
	case allWordsPresent(d, q):
		// FDC scatters a multi-word ingredient across its qualifiers:
		// "chicken breast" lives in "Chicken, broilers or fryers, breast, meat
		// only, raw". Every word present, out of order, is still a good match.
		score = 0.6
	default:
		score = 0.3 * tokenOverlap(q, d)
	}

	switch dataType {
	case "Foundation":
		score += 0.03 // laboratory-analysed, and the best-curated portions
	case "SR Legacy":
		score += 0.02
	case "Branded":
		score -= 0.15 // a specific product, rarely what a recipe line means
	}
	return clamp01(round(score, 3))
}

// containsWord reports whether needle appears in haystack on word boundaries, so
// "corn" does not match "cornstarch".
func containsWord(haystack, needle string) bool {
	fields := strings.FieldsFunc(haystack, func(r rune) bool {
		return r == ' ' || r == ',' || r == '-' || r == '/' || r == '(' || r == ')'
	})
	needleFields := strings.Fields(needle)
	for i := range fields {
		if len(fields)-i < len(needleFields) {
			break
		}
		matched := true
		for j, nf := range needleFields {
			if fields[i+j] != nf {
				matched = false
				break
			}
		}
		if matched {
			return true
		}
	}
	return false
}

// allWordsPresent reports whether every word of the query appears in the
// description on a word boundary, in any order.
func allWordsPresent(description, query string) bool {
	for _, t := range strings.Fields(query) {
		if !containsWord(description, t) {
			return false
		}
	}
	return true
}

// tokenOverlap is the fraction of the query's words that appear anywhere in the
// description — the weak last-resort signal when nothing matched cleanly.
func tokenOverlap(query, description string) float64 {
	qs := strings.Fields(query)
	if len(qs) == 0 {
		return 0
	}
	hit := 0
	for _, t := range qs {
		if strings.Contains(description, t) {
			hit++
		}
	}
	return float64(hit) / float64(len(qs))
}

func clamp01(v float64) float64 {
	switch {
	case v < 0:
		return 0
	case v > 1:
		return 1
	default:
		return v
	}
}
