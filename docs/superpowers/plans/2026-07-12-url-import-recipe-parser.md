# URL Import + Recipe Parser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user paste a recipe URL and get a structured, editable recipe preview they confirm before it is saved to the canonical recipe-service store.

**Architecture:** A URL-import pipeline added in-process to the Go `recipe-service`: a guarded fetcher pulls the page, a deterministic JSON-LD extractor + ingredient-line parser handle the common case, and a Claude (Haiku 4.5) extractor over stdlib `net/http` is the fallback when a page has no usable schema.org `Recipe` JSON-LD. A new `POST /recipes/import` endpoint returns a **preview** `Recipe` (never persisted); the web app drops it into the existing recipe form and saves through the existing `POST /recipes` path. A new Convex `importFromUrl` action proxies the call with the service secret.

**Tech Stack:** Go 1.25 (stdlib only — no new modules), self-hosted Convex (TypeScript actions), React + Vite + TypeScript web, Claude Messages API (`claude-haiku-4-5`) via raw `net/http`.

## Global Constraints

- **No new Go module dependencies.** recipe-service is deliberately dependency-minimal (`go.mod` requires only `pgx`; `id.go` uses `crypto/rand` specifically to avoid a UUID dep). The Claude call MUST use stdlib `net/http`, not `anthropic-sdk-go`. HTML/JSON-LD parsing MUST use stdlib (`regexp`, `encoding/json`, `html`), not `golang.org/x/net/html`.
- **Import code lives in `package recipe`** in new `import_*.go` files (matching how `normalize.go`, `aggregate.go`, `catalog.go` are organized), not a separate subpackage. It reuses the existing `Recipe`/`Ingredient` types.
- **The service secret never reaches the browser.** All recipe-service calls are proxied through Convex actions in `packages/convex/convex/recipes.ts` via the existing `recipeServiceFetch` helper.
- **Contract is hand-mirrored** between Go structs and `packages/types/src/index.ts` (known drift risk per the M1 design). Any new request/response shape is added to both.
- **Graceful degradation:** when `ANTHROPIC_API_KEY` is unset, the LLM fallback is disabled; JSON-LD imports still work, and a page with no JSON-LD returns `422`. No test makes a live Claude call.
- **Model:** `claude-haiku-4-5` for extraction. Structured output via `output_config.format` (JSON schema). Anthropic API version header `2023-06-01`.
- Preserve existing behavior: `NewRouter(store, secret)` keeps its signature (delegates with a nil importer).

**Spec:** `docs/superpowers/specs/2026-07-12-url-import-recipe-parser-design.md`. Three intentional deviations from the spec, all recorded above: stdlib `net/http` instead of the Go SDK; `package recipe` with `import_*.go` files instead of an `internal/recipeimport` subpackage; `NewRouterWithImporter` added alongside `NewRouter`.

---

### Task 1: Ingredient line parser

Deterministic parse of a free-text ingredient line into `Ingredient{quantity, unit, item, note}`. Pure, no I/O. Highest-value logic in the slice; test it hard.

**Files:**
- Create: `apps/recipe-service/internal/recipe/import_lineparser.go`
- Test: `apps/recipe-service/internal/recipe/import_lineparser_test.go`

**Interfaces:**
- Consumes: `Ingredient` (from `types.go`).
- Produces: `func parseIngredientLine(line string) Ingredient` — used by the Importer (Task 5).

- [ ] **Step 1: Write the failing test**

```go
// apps/recipe-service/internal/recipe/import_lineparser_test.go
package recipe

import "testing"

func TestParseIngredientLine(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want Ingredient
	}{
		{"qty unit item note", "2 cloves garlic, minced", Ingredient{Quantity: 2, Unit: "clove", Item: "garlic", Note: "minced"}},
		{"mixed number", "1 1/2 cups flour", Ingredient{Quantity: 1.5, Unit: "cup", Item: "flour"}},
		{"unicode fraction", "½ teaspoon salt", Ingredient{Quantity: 0.5, Unit: "tsp", Item: "salt"}},
		{"glued unicode fraction", "1½ cups sugar", Ingredient{Quantity: 1.5, Unit: "cup", Item: "sugar"}},
		{"range takes low", "1-2 tablespoons olive oil", Ingredient{Quantity: 1, Unit: "tbsp", Item: "olive oil"}},
		{"no unit", "3 large eggs", Ingredient{Quantity: 3, Unit: "", Item: "large eggs"}},
		{"no quantity", "Salt to taste", Ingredient{Quantity: 0, Unit: "", Item: "Salt to taste"}},
		{"decimal", "0.5 cup milk", Ingredient{Quantity: 0.5, Unit: "cup", Item: "milk"}},
		{"simple fraction", "3/4 cup butter", Ingredient{Quantity: 0.75, Unit: "cup", Item: "butter"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := parseIngredientLine(tc.in)
			if got != tc.want {
				t.Fatalf("parseIngredientLine(%q) = %+v, want %+v", tc.in, got, tc.want)
			}
		})
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/recipe-service && go test ./internal/recipe/ -run TestParseIngredientLine`
Expected: FAIL — `undefined: parseIngredientLine`.

- [ ] **Step 3: Write minimal implementation**

```go
// apps/recipe-service/internal/recipe/import_lineparser.go
package recipe

import (
	"strconv"
	"strings"
)

// unicodeFractions maps the common single-rune fraction glyphs to their value.
var unicodeFractions = map[rune]float64{
	'½': 0.5, '⅓': 1.0 / 3, '⅔': 2.0 / 3, '¼': 0.25, '¾': 0.75,
	'⅕': 0.2, '⅖': 0.4, '⅗': 0.6, '⅘': 0.8, '⅙': 1.0 / 6,
	'⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875,
}

// knownUnits maps recognized unit tokens (lowercased) to a canonical label.
// Tokens not present here are treated as part of the item text.
var knownUnits = map[string]string{
	"teaspoon": "tsp", "teaspoons": "tsp", "tsp": "tsp", "tsps": "tsp",
	"tablespoon": "tbsp", "tablespoons": "tbsp", "tbsp": "tbsp", "tbsps": "tbsp",
	"cup": "cup", "cups": "cup",
	"ounce": "oz", "ounces": "oz", "oz": "oz",
	"pound": "lb", "pounds": "lb", "lb": "lb", "lbs": "lb",
	"gram": "g", "grams": "g", "g": "g",
	"kilogram": "kg", "kilograms": "kg", "kg": "kg",
	"milliliter": "ml", "milliliters": "ml", "ml": "ml",
	"liter": "l", "liters": "l", "l": "l",
	"clove": "clove", "cloves": "clove",
	"can": "can", "cans": "can",
	"pinch": "pinch", "pinches": "pinch",
	"slice": "slice", "slices": "slice",
}

// parseIngredientLine turns "2 cloves garlic, minced" into a structured
// Ingredient. A trailing comma clause becomes the note. A line with no leading
// quantity yields quantity 0, empty unit, and the whole line as the item — the
// normalizer already tolerates unknown items/units, so nothing breaks downstream.
func parseIngredientLine(line string) Ingredient {
	line = strings.TrimSpace(line)
	note := ""
	if i := strings.IndexByte(line, ','); i >= 0 {
		note = strings.TrimSpace(line[i+1:])
		line = strings.TrimSpace(line[:i])
	}
	tokens := strings.Fields(line)
	qty, rest, ok := parseQuantity(tokens)
	if !ok {
		return Ingredient{Item: line, Note: note}
	}
	unit := ""
	if len(rest) > 0 {
		if u, isUnit := knownUnits[strings.ToLower(strings.Trim(rest[0], "."))]; isUnit {
			unit = u
			rest = rest[1:]
		}
	}
	return Ingredient{Quantity: qty, Unit: unit, Item: strings.Join(rest, " "), Note: note}
}

// parseQuantity reads a leading quantity, including a "1 1/2" whole+fraction pair.
func parseQuantity(tokens []string) (float64, []string, bool) {
	if len(tokens) == 0 {
		return 0, tokens, false
	}
	total, ok := parseNumberToken(tokens[0])
	if !ok {
		return 0, tokens, false
	}
	rest := tokens[1:]
	if len(rest) > 0 {
		if frac, isFrac := parseFractionOnly(rest[0]); isFrac {
			total += frac
			rest = rest[1:]
		}
	}
	return total, rest, true
}

// parseNumberToken parses "1", "1.5", "1/2", "1-2" (range low), "½", or "1½".
func parseNumberToken(tok string) (float64, bool) {
	if tok == "" {
		return 0, false
	}
	runes := []rune(tok)
	var extra float64
	if f, ok := unicodeFractions[runes[len(runes)-1]]; ok {
		extra = f
		tok = string(runes[:len(runes)-1])
		if tok == "" {
			return extra, true // bare "½"
		}
	}
	if i := strings.IndexByte(tok, '-'); i > 0 { // range → low value
		tok = tok[:i]
	}
	if f, ok := parseFractionOnly(tok); ok {
		return f + extra, true
	}
	if v, err := strconv.ParseFloat(tok, 64); err == nil {
		return v + extra, true
	}
	return 0, false
}

// parseFractionOnly parses "3/4" into 0.75. False if the token is not a fraction.
func parseFractionOnly(tok string) (float64, bool) {
	i := strings.IndexByte(tok, '/')
	if i <= 0 || i == len(tok)-1 {
		return 0, false
	}
	num, err1 := strconv.ParseFloat(tok[:i], 64)
	den, err2 := strconv.ParseFloat(tok[i+1:], 64)
	if err1 != nil || err2 != nil || den == 0 {
		return 0, false
	}
	return num / den, true
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/recipe-service && go test ./internal/recipe/ -run TestParseIngredientLine`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/recipe-service/internal/recipe/import_lineparser.go apps/recipe-service/internal/recipe/import_lineparser_test.go
git commit -m "feat(recipe-import): deterministic ingredient-line parser"
```

---

### Task 2: JSON-LD recipe extractor

Extract `{title, ingredientLines, steps}` from schema.org `Recipe` JSON-LD in a page. Pure, stdlib-only (regex to find `<script type="application/ld+json">` blocks, `encoding/json` to walk them).

**Files:**
- Create: `apps/recipe-service/internal/recipe/import_jsonld.go`
- Test: `apps/recipe-service/internal/recipe/import_jsonld_test.go`

**Interfaces:**
- Produces: `type jsonLDRecipe struct { Title string; IngredientLines []string; Steps []string }` and `func extractJSONLD(html []byte) (jsonLDRecipe, bool)` — used by the Importer (Task 5).

- [ ] **Step 1: Write the failing test**

```go
// apps/recipe-service/internal/recipe/import_jsonld_test.go
package recipe

import (
	"reflect"
	"testing"
)

const pageWithGraph = `<html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@graph":[
  {"@type":"WebPage","name":"ignore me"},
  {"@type":["Recipe","Thing"],"name":"Garlic Bread",
   "recipeIngredient":["2 cloves garlic, minced","1 loaf bread"],
   "recipeInstructions":[{"@type":"HowToStep","text":"Mince the garlic."},{"@type":"HowToStep","text":"Toast the bread."}]}
]}
</script></head><body></body></html>`

const pageNoRecipe = `<html><head>
<script type="application/ld+json">{"@type":"WebSite","name":"nope"}</script>
</head></html>`

func TestExtractJSONLD_Graph(t *testing.T) {
	got, ok := extractJSONLD([]byte(pageWithGraph))
	if !ok {
		t.Fatal("expected a Recipe node to be found")
	}
	if got.Title != "Garlic Bread" {
		t.Errorf("title = %q, want Garlic Bread", got.Title)
	}
	wantIng := []string{"2 cloves garlic, minced", "1 loaf bread"}
	if !reflect.DeepEqual(got.IngredientLines, wantIng) {
		t.Errorf("ingredients = %v, want %v", got.IngredientLines, wantIng)
	}
	wantSteps := []string{"Mince the garlic.", "Toast the bread."}
	if !reflect.DeepEqual(got.Steps, wantSteps) {
		t.Errorf("steps = %v, want %v", got.Steps, wantSteps)
	}
}

func TestExtractJSONLD_NoRecipe(t *testing.T) {
	if _, ok := extractJSONLD([]byte(pageNoRecipe)); ok {
		t.Fatal("expected no Recipe node")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/recipe-service && go test ./internal/recipe/ -run TestExtractJSONLD`
Expected: FAIL — `undefined: extractJSONLD`.

- [ ] **Step 3: Write minimal implementation**

```go
// apps/recipe-service/internal/recipe/import_jsonld.go
package recipe

import (
	"encoding/json"
	"regexp"
	"strings"
)

// ldScriptRe matches the inner text of every <script type="application/ld+json">.
var ldScriptRe = regexp.MustCompile(`(?is)<script[^>]*type\s*=\s*["']application/ld\+json["'][^>]*>(.*?)</script>`)

type jsonLDRecipe struct {
	Title           string
	IngredientLines []string
	Steps           []string
}

// extractJSONLD scans a page for schema.org Recipe JSON-LD and returns the first
// Recipe node found. ok is false when no usable Recipe node is present.
func extractJSONLD(html []byte) (jsonLDRecipe, bool) {
	for _, m := range ldScriptRe.FindAllSubmatch(html, -1) {
		var doc any
		if err := json.Unmarshal(m[1], &doc); err != nil {
			continue
		}
		if rec, ok := findRecipeNode(doc); ok {
			return rec, true
		}
	}
	return jsonLDRecipe{}, false
}

// findRecipeNode walks arrays and @graph wrappers looking for a Recipe object.
func findRecipeNode(node any) (jsonLDRecipe, bool) {
	switch v := node.(type) {
	case []any:
		for _, item := range v {
			if rec, ok := findRecipeNode(item); ok {
				return rec, true
			}
		}
	case map[string]any:
		if hasType(v["@type"], "Recipe") {
			return buildRecipe(v), true
		}
		if g, ok := v["@graph"]; ok {
			return findRecipeNode(g)
		}
	}
	return jsonLDRecipe{}, false
}

// hasType reports whether a JSON-LD @type (a string or list of strings) includes want.
func hasType(t any, want string) bool {
	switch v := t.(type) {
	case string:
		return v == want
	case []any:
		for _, item := range v {
			if s, ok := item.(string); ok && s == want {
				return true
			}
		}
	}
	return false
}

func buildRecipe(m map[string]any) jsonLDRecipe {
	rec := jsonLDRecipe{Title: asString(m["name"])}
	for _, ing := range asStringSlice(m["recipeIngredient"]) {
		if s := strings.TrimSpace(ing); s != "" {
			rec.IngredientLines = append(rec.IngredientLines, s)
		}
	}
	rec.Steps = extractSteps(m["recipeInstructions"])
	return rec
}

func asString(v any) string {
	s, _ := v.(string)
	return strings.TrimSpace(s)
}

// asStringSlice accepts a string or a list of strings and returns a slice.
func asStringSlice(v any) []string {
	switch t := v.(type) {
	case string:
		return []string{t}
	case []any:
		out := make([]string, 0, len(t))
		for _, item := range t {
			if s, ok := item.(string); ok {
				out = append(out, s)
			}
		}
		return out
	}
	return nil
}

// extractSteps handles recipeInstructions as a string, a list of strings, or a
// list of HowToStep/HowToSection objects carrying a "text" field.
func extractSteps(v any) []string {
	var out []string
	switch t := v.(type) {
	case string:
		if s := strings.TrimSpace(t); s != "" {
			out = append(out, s)
		}
	case []any:
		for _, item := range t {
			switch step := item.(type) {
			case string:
				if s := strings.TrimSpace(step); s != "" {
					out = append(out, s)
				}
			case map[string]any:
				if s := asString(step["text"]); s != "" {
					out = append(out, s)
				}
			}
		}
	}
	return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/recipe-service && go test ./internal/recipe/ -run TestExtractJSONLD`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/recipe-service/internal/recipe/import_jsonld.go apps/recipe-service/internal/recipe/import_jsonld_test.go
git commit -m "feat(recipe-import): schema.org JSON-LD recipe extractor"
```

---

### Task 3: Guarded HTTP fetcher

Fetch a URL to HTML bytes with a scheme allowlist, timeout, size cap, and an SSRF guard that rejects loopback/private/link-local targets at dial time.

**Files:**
- Create: `apps/recipe-service/internal/recipe/import_fetch.go`
- Test: `apps/recipe-service/internal/recipe/import_fetch_test.go`

**Interfaces:**
- Produces:
  - `type Fetcher interface { Fetch(ctx context.Context, url string) ([]byte, error) }`
  - `func NewHTTPFetcher() *httpFetcher`
  - sentinel errors `ErrImportBadURL`, `ErrImportFetch` (defined here; also used by the handler in Task 6).

- [ ] **Step 1: Write the failing test**

```go
// apps/recipe-service/internal/recipe/import_fetch_test.go
package recipe

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHTTPFetcher_RejectsNonHTTPScheme(t *testing.T) {
	_, err := NewHTTPFetcher().Fetch(context.Background(), "file:///etc/passwd")
	if !errors.Is(err, ErrImportBadURL) {
		t.Fatalf("err = %v, want ErrImportBadURL", err)
	}
}

func TestHTTPFetcher_RejectsLoopback(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("<html></html>"))
	}))
	defer srv.Close()
	// srv.URL points at 127.0.0.1 — the SSRF guard must refuse to dial it.
	if _, err := NewHTTPFetcher().Fetch(context.Background(), srv.URL); err == nil {
		t.Fatal("expected loopback fetch to be rejected")
	}
}

func TestHTTPFetcher_ReadsBodyWithSizeCap(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("<html>hello</html>"))
	}))
	defer srv.Close()
	f := &httpFetcher{client: srv.Client(), maxBytes: 4} // client bypasses the SSRF dialer
	body, err := f.Fetch(context.Background(), srv.URL)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(body) != 4 {
		t.Fatalf("body len = %d, want 4 (size cap)", len(body))
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/recipe-service && go test ./internal/recipe/ -run TestHTTPFetcher`
Expected: FAIL — `undefined: NewHTTPFetcher` / `ErrImportBadURL`.

- [ ] **Step 3: Write minimal implementation**

```go
// apps/recipe-service/internal/recipe/import_fetch.go
package recipe

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"syscall"
	"time"
)

// Import error sentinels. The handler maps these to HTTP status codes.
var (
	ErrImportBadURL      = errors.New("invalid or disallowed url")
	ErrImportFetch       = errors.New("could not fetch the url")
	ErrImportUnparseable = errors.New("could not extract a recipe from the page")
)

// Fetcher fetches a URL and returns the response body.
type Fetcher interface {
	Fetch(ctx context.Context, url string) ([]byte, error)
}

type httpFetcher struct {
	client   *http.Client
	maxBytes int64
}

// NewHTTPFetcher builds a fetcher whose dialer refuses loopback, private, and
// link-local addresses (SSRF guard). The check runs at connect time on the
// resolved IP, so DNS rebinding cannot slip past it.
func NewHTTPFetcher() *httpFetcher {
	dialer := &net.Dialer{
		Timeout: 5 * time.Second,
		Control: func(_, address string, _ syscall.RawConn) error {
			host, _, err := net.SplitHostPort(address)
			if err != nil {
				return err
			}
			if ip := net.ParseIP(host); ip != nil && isDisallowedIP(ip) {
				return ErrImportBadURL
			}
			return nil
		},
	}
	return &httpFetcher{
		client: &http.Client{
			Timeout:   10 * time.Second,
			Transport: &http.Transport{DialContext: dialer.DialContext},
			// Cap redirect chains.
			CheckRedirect: func(_ *http.Request, via []*http.Request) error {
				if len(via) >= 5 {
					return fmt.Errorf("%w: too many redirects", ErrImportFetch)
				}
				return nil
			},
		},
		maxBytes: 2 << 20, // 2 MiB
	}
}

func isDisallowedIP(ip net.IP) bool {
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsUnspecified() ||
		ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast()
}

func (f *httpFetcher) Fetch(ctx context.Context, rawURL string) ([]byte, error) {
	u, err := url.Parse(rawURL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return nil, fmt.Errorf("%w", ErrImportBadURL)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, fmt.Errorf("%w", ErrImportBadURL)
	}
	req.Header.Set("User-Agent", "pantry-recipe-importer/1.0")
	resp, err := f.client.Do(req)
	if err != nil {
		if errors.Is(err, ErrImportBadURL) {
			return nil, err
		}
		return nil, fmt.Errorf("%w: %v", ErrImportFetch, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("%w: status %d", ErrImportFetch, resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, f.maxBytes))
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrImportFetch, err)
	}
	return body, nil
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/recipe-service && go test ./internal/recipe/ -run TestHTTPFetcher`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/recipe-service/internal/recipe/import_fetch.go apps/recipe-service/internal/recipe/import_fetch_test.go
git commit -m "feat(recipe-import): SSRF-guarded HTTP fetcher"
```

---

### Task 4: Claude extractor (LLM fallback over net/http)

An `Extractor` that sends cleaned page text to Claude (`claude-haiku-4-5`) and gets back structured `{title, ingredients[]}` via structured output. Raw `net/http`; base URL is injectable so tests use a canned `httptest` Messages endpoint — no live calls.

**Files:**
- Create: `apps/recipe-service/internal/recipe/import_llm.go`
- Test: `apps/recipe-service/internal/recipe/import_llm_test.go`

**Interfaces:**
- Produces:
  - `type ExtractedRecipe struct { Title string; Ingredients []Ingredient; Steps []string }`
  - `type Extractor interface { Extract(ctx context.Context, pageText string) (ExtractedRecipe, error) }`
  - `func NewClaudeExtractor(apiKey string) *claudeExtractor`

- [ ] **Step 1: Write the failing test**

```go
// apps/recipe-service/internal/recipe/import_llm_test.go
package recipe

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestClaudeExtractor_ParsesStructuredOutput(t *testing.T) {
	var gotKey, gotPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotKey = r.Header.Get("x-api-key")
		gotPath = r.URL.Path
		_, _ = io.ReadAll(r.Body)
		resp := map[string]any{
			"stop_reason": "end_turn",
			"content": []map[string]any{{
				"type": "text",
				"text": `{"title":"Soup","ingredients":[{"quantity":2,"unit":"cup","item":"broth"}]}`,
			}},
		}
		w.Header().Set("content-type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}))
	defer srv.Close()

	c := NewClaudeExtractor("test-key")
	c.baseURL = srv.URL
	c.client = srv.Client()

	got, err := c.Extract(context.Background(), "some page text")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if gotKey != "test-key" {
		t.Errorf("x-api-key = %q, want test-key", gotKey)
	}
	if gotPath != "/v1/messages" {
		t.Errorf("path = %q, want /v1/messages", gotPath)
	}
	if got.Title != "Soup" || len(got.Ingredients) != 1 || got.Ingredients[0].Item != "broth" {
		t.Fatalf("unexpected extraction: %+v", got)
	}
}

func TestClaudeExtractor_Refusal(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, `{"stop_reason":"refusal","content":[]}`)
	}))
	defer srv.Close()
	c := NewClaudeExtractor("k")
	c.baseURL = srv.URL
	c.client = srv.Client()
	if _, err := c.Extract(context.Background(), "x"); err == nil || !strings.Contains(err.Error(), "refus") {
		t.Fatalf("err = %v, want a refusal error", err)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/recipe-service && go test ./internal/recipe/ -run TestClaudeExtractor`
Expected: FAIL — `undefined: NewClaudeExtractor`.

- [ ] **Step 3: Write minimal implementation**

```go
// apps/recipe-service/internal/recipe/import_llm.go
package recipe

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"
)

const claudeModel = "claude-haiku-4-5"

const extractSystemPrompt = `You extract structured recipe data from the text of a web page.
Return only the recipe's title and its ingredient list. For each ingredient, split it into a
numeric quantity, a unit (empty string if none), the core item name, and an optional note
(e.g. "minced", "at room temperature"). If a value is absent, use 0 for quantity and "" for
unit. Do not invent ingredients that are not present in the text.`

// recipeJSONSchema constrains the model's output (Anthropic structured outputs).
var recipeJSONSchema = map[string]any{
	"type":                 "object",
	"additionalProperties": false,
	"required":             []string{"title", "ingredients"},
	"properties": map[string]any{
		"title": map[string]any{"type": "string"},
		"ingredients": map[string]any{
			"type": "array",
			"items": map[string]any{
				"type":                 "object",
				"additionalProperties": false,
				"required":             []string{"quantity", "unit", "item"},
				"properties": map[string]any{
					"quantity": map[string]any{"type": "number"},
					"unit":     map[string]any{"type": "string"},
					"item":     map[string]any{"type": "string"},
					"note":     map[string]any{"type": "string"},
				},
			},
		},
	},
}

type ExtractedRecipe struct {
	Title       string
	Ingredients []Ingredient
	Steps       []string
}

// Extractor turns cleaned page text into a structured recipe (LLM fallback).
type Extractor interface {
	Extract(ctx context.Context, pageText string) (ExtractedRecipe, error)
}

type claudeExtractor struct {
	apiKey  string
	model   string
	baseURL string
	client  *http.Client
}

// NewClaudeExtractor builds an Extractor backed by the Claude Messages API.
// Uses stdlib net/http to honor the service's no-new-dependency constraint.
func NewClaudeExtractor(apiKey string) *claudeExtractor {
	return &claudeExtractor{
		apiKey:  apiKey,
		model:   claudeModel,
		baseURL: "https://api.anthropic.com",
		client:  &http.Client{Timeout: 30 * time.Second},
	}
}

func (c *claudeExtractor) Extract(ctx context.Context, pageText string) (ExtractedRecipe, error) {
	reqBody := map[string]any{
		"model":      c.model,
		"max_tokens": 4096,
		"system":     extractSystemPrompt,
		"messages":   []map[string]any{{"role": "user", "content": pageText}},
		"output_config": map[string]any{
			"format": map[string]any{"type": "json_schema", "schema": recipeJSONSchema},
		},
	}
	buf, err := json.Marshal(reqBody)
	if err != nil {
		return ExtractedRecipe{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/v1/messages", bytes.NewReader(buf))
	if err != nil {
		return ExtractedRecipe{}, err
	}
	req.Header.Set("content-type", "application/json")
	req.Header.Set("x-api-key", c.apiKey)
	req.Header.Set("anthropic-version", "2023-06-01")

	resp, err := c.client.Do(req)
	if err != nil {
		return ExtractedRecipe{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return ExtractedRecipe{}, fmt.Errorf("claude: status %d", resp.StatusCode)
	}

	var apiResp struct {
		StopReason string `json:"stop_reason"`
		Content    []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&apiResp); err != nil {
		return ExtractedRecipe{}, err
	}
	if apiResp.StopReason == "refusal" {
		return ExtractedRecipe{}, errors.New("claude refused the request")
	}

	var text string
	for _, block := range apiResp.Content {
		if block.Type == "text" {
			text = block.Text
			break
		}
	}
	if text == "" {
		return ExtractedRecipe{}, errors.New("claude returned no text block")
	}

	var parsed struct {
		Title       string       `json:"title"`
		Ingredients []Ingredient `json:"ingredients"`
	}
	if err := json.Unmarshal([]byte(text), &parsed); err != nil {
		return ExtractedRecipe{}, fmt.Errorf("claude output was not valid JSON: %w", err)
	}
	return ExtractedRecipe{Title: parsed.Title, Ingredients: parsed.Ingredients}, nil
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/recipe-service && go test ./internal/recipe/ -run TestClaudeExtractor`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/recipe-service/internal/recipe/import_llm.go apps/recipe-service/internal/recipe/import_llm_test.go
git commit -m "feat(recipe-import): Claude extractor fallback over net/http"
```

---

### Task 5: Importer orchestrator + HTML→text helper

Combine fetch → JSON-LD (deterministic line parse) → LLM fallback into one `Importer` that returns a preview `Recipe`. Includes the `htmlToText` cleaner used to feed the LLM.

**Files:**
- Create: `apps/recipe-service/internal/recipe/import.go`
- Create: `apps/recipe-service/internal/recipe/import_text.go`
- Test: `apps/recipe-service/internal/recipe/import_test.go`

**Interfaces:**
- Consumes: `Fetcher`, `Extractor`, `extractJSONLD`, `parseIngredientLine`, `Recipe`.
- Produces:
  - `type Importer struct { ... }` with `func NewImporter(f Fetcher, e Extractor) *Importer` and `func (imp *Importer) Import(ctx context.Context, userID, rawURL string) (Recipe, error)`.
  - Test fakes `fakeFetcher` and `fakeExtractor` (in `import_test.go`) — reused by the handler test in Task 6.

- [ ] **Step 1: Write the failing test**

```go
// apps/recipe-service/internal/recipe/import_test.go
package recipe

import (
	"context"
	"errors"
	"testing"
)

type fakeFetcher struct {
	body []byte
	err  error
}

func (f fakeFetcher) Fetch(context.Context, string) ([]byte, error) { return f.body, f.err }

type fakeExtractor struct {
	rec ExtractedRecipe
	err error
}

func (f fakeExtractor) Extract(context.Context, string) (ExtractedRecipe, error) {
	return f.rec, f.err
}

func TestImporter_JSONLDPath(t *testing.T) {
	imp := NewImporter(fakeFetcher{body: []byte(pageWithGraph)}, nil)
	rec, err := imp.Import(context.Background(), "u1", "https://example.com/r")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if rec.UserID != "u1" || rec.Title != "Garlic Bread" || len(rec.Ingredients) != 2 {
		t.Fatalf("unexpected recipe: %+v", rec)
	}
	if rec.Ingredients[0] != (Ingredient{Quantity: 2, Unit: "clove", Item: "garlic", Note: "minced"}) {
		t.Fatalf("first ingredient not parsed: %+v", rec.Ingredients[0])
	}
	if rec.ID != "" {
		t.Errorf("preview must not carry an id, got %q", rec.ID)
	}
}

func TestImporter_LLMFallback(t *testing.T) {
	ex := fakeExtractor{rec: ExtractedRecipe{
		Title:       "Soup",
		Ingredients: []Ingredient{{Quantity: 1, Unit: "cup", Item: "broth"}},
	}}
	imp := NewImporter(fakeFetcher{body: []byte("<html>no json-ld here</html>")}, ex)
	rec, err := imp.Import(context.Background(), "u1", "https://example.com/r")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if rec.Title != "Soup" || len(rec.Ingredients) != 1 {
		t.Fatalf("unexpected recipe: %+v", rec)
	}
}

func TestImporter_NoJSONLDNoExtractor(t *testing.T) {
	imp := NewImporter(fakeFetcher{body: []byte("<html>nothing</html>")}, nil)
	_, err := imp.Import(context.Background(), "u1", "https://example.com/r")
	if !errors.Is(err, ErrImportUnparseable) {
		t.Fatalf("err = %v, want ErrImportUnparseable", err)
	}
}

func TestImporter_FetchErrorPropagates(t *testing.T) {
	imp := NewImporter(fakeFetcher{err: ErrImportFetch}, nil)
	_, err := imp.Import(context.Background(), "u1", "https://example.com/r")
	if !errors.Is(err, ErrImportFetch) {
		t.Fatalf("err = %v, want ErrImportFetch", err)
	}
}

func TestHTMLToText_StripsTagsAndScripts(t *testing.T) {
	got := htmlToText([]byte(`<html><head><style>x{}</style></head><body><script>bad()</script><p>Hello  world</p></body></html>`))
	if got != "Hello world" {
		t.Fatalf("htmlToText = %q, want %q", got, "Hello world")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/recipe-service && go test ./internal/recipe/ -run 'TestImporter|TestHTMLToText'`
Expected: FAIL — `undefined: NewImporter` / `htmlToText`.

- [ ] **Step 3: Write minimal implementation**

```go
// apps/recipe-service/internal/recipe/import.go
package recipe

import (
	"context"
	"fmt"
	"strings"
)

// Importer turns a recipe URL into a preview Recipe (never persisted).
type Importer struct {
	fetcher   Fetcher
	extractor Extractor // may be nil: LLM fallback disabled
}

func NewImporter(f Fetcher, e Extractor) *Importer {
	return &Importer{fetcher: f, extractor: e}
}

// Import fetches the URL, extracts a recipe (JSON-LD first, LLM fallback), and
// returns a preview Recipe scoped to userID. The returned recipe has no id and
// is not stored — the caller persists it later through the normal create path.
func (imp *Importer) Import(ctx context.Context, userID, rawURL string) (Recipe, error) {
	html, err := imp.fetcher.Fetch(ctx, rawURL)
	if err != nil {
		return Recipe{}, err // ErrImportBadURL or ErrImportFetch
	}

	var title string
	var ings []Ingredient

	if ld, ok := extractJSONLD(html); ok && len(ld.IngredientLines) > 0 {
		title = ld.Title
		for _, line := range ld.IngredientLines {
			ings = append(ings, parseIngredientLine(line))
		}
	} else if imp.extractor != nil {
		ex, err := imp.extractor.Extract(ctx, htmlToText(html))
		if err != nil {
			return Recipe{}, fmt.Errorf("%w: %v", ErrImportUnparseable, err)
		}
		title, ings = ex.Title, ex.Ingredients
	} else {
		return Recipe{}, ErrImportUnparseable
	}

	if strings.TrimSpace(title) == "" || len(ings) == 0 {
		return Recipe{}, ErrImportUnparseable
	}
	return Recipe{UserID: userID, Title: strings.TrimSpace(title), Ingredients: ings}, nil
}
```

```go
// apps/recipe-service/internal/recipe/import_text.go
package recipe

import (
	"html"
	"regexp"
	"strings"
)

const maxLLMChars = 12000

var (
	scriptStyleRe = regexp.MustCompile(`(?is)<(script|style)[^>]*>.*?</(script|style)>`)
	tagRe         = regexp.MustCompile(`(?s)<[^>]+>`)
	wsRe          = regexp.MustCompile(`\s+`)
)

// htmlToText produces a compact plain-text rendering of a page for the LLM:
// scripts/styles removed, tags stripped, entities unescaped, whitespace
// collapsed, and truncated to a token-bounding character budget.
func htmlToText(raw []byte) string {
	s := scriptStyleRe.ReplaceAllString(string(raw), " ")
	s = tagRe.ReplaceAllString(s, " ")
	s = html.UnescapeString(s)
	s = strings.TrimSpace(wsRe.ReplaceAllString(s, " "))
	if len(s) > maxLLMChars {
		s = s[:maxLLMChars]
	}
	return s
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/recipe-service && go test ./internal/recipe/ -run 'TestImporter|TestHTMLToText'`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/recipe-service/internal/recipe/import.go apps/recipe-service/internal/recipe/import_text.go apps/recipe-service/internal/recipe/import_test.go
git commit -m "feat(recipe-import): importer orchestrator + html-to-text cleaner"
```

---

### Task 6: `POST /recipes/import` handler + router + server wiring

Add the endpoint, wire the importer through a new `NewRouterWithImporter` constructor (keeping `NewRouter` intact), and build the importer in `main.go` from `ANTHROPIC_API_KEY`.

**Files:**
- Modify: `apps/recipe-service/internal/recipe/handler.go`
- Modify: `apps/recipe-service/cmd/server/main.go:47`
- Modify: `apps/recipe-service/.env.example`
- Test: `apps/recipe-service/internal/recipe/handler_test.go` (add import cases)

**Interfaces:**
- Consumes: `*Importer`, `ErrImportBadURL`, `ErrImportFetch`, `ErrImportUnparseable`, `fakeFetcher` (Task 5).
- Produces: `func NewRouterWithImporter(store Store, secret string, imp *Importer) http.Handler`; route `POST /recipes/import`.

- [ ] **Step 1: Write the failing test**

Append to `apps/recipe-service/internal/recipe/handler_test.go`. (Note the existing test file already has helpers for building requests with the service secret + user id — reuse the same pattern it uses for `POST /recipes`; the snippet below assumes a `testSecret` const and standard `http` calls like the rest of the file.)

```go
func TestImportRecipe_JSONLD(t *testing.T) {
	imp := NewImporter(fakeFetcher{body: []byte(pageWithGraph)}, nil)
	srv := httptest.NewServer(NewRouterWithImporter(NewMemoryStore(), testSecret, imp))
	defer srv.Close()

	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/recipes/import",
		strings.NewReader(`{"url":"https://example.com/r"}`))
	req.Header.Set("X-Service-Secret", testSecret)
	req.Header.Set("X-User-Id", "u1")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	var got Recipe
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.Title != "Garlic Bread" || len(got.Ingredients) != 2 {
		t.Fatalf("unexpected preview: %+v", got)
	}
}

func TestImportRecipe_DisabledWhenNoImporter(t *testing.T) {
	// NewRouter (no importer) must report the feature unavailable, not panic.
	srv := httptest.NewServer(NewRouter(NewMemoryStore(), testSecret))
	defer srv.Close()
	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/recipes/import",
		strings.NewReader(`{"url":"https://example.com/r"}`))
	req.Header.Set("X-Service-Secret", testSecret)
	req.Header.Set("X-User-Id", "u1")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", resp.StatusCode)
	}
}
```

Ensure the test file imports `encoding/json`, `net/http`, `net/http/httptest`, and `strings` (add any missing).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/recipe-service && go test ./internal/recipe/ -run TestImportRecipe`
Expected: FAIL — `undefined: NewRouterWithImporter`.

- [ ] **Step 3: Write minimal implementation**

In `handler.go`, replace the `NewRouter` function and add the importer field + handler:

```go
func NewRouter(store Store, secret string) http.Handler {
	return NewRouterWithImporter(store, secret, nil)
}

// NewRouterWithImporter is NewRouter plus URL import. imp may be nil, in which
// case POST /recipes/import responds 503 (import not configured).
func NewRouterWithImporter(store Store, secret string, imp *Importer) http.Handler {
	h := &handlers{store: store, importer: imp}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", h.healthz)
	mux.HandleFunc("POST /recipes", h.createRecipe)
	mux.HandleFunc("GET /recipes", h.listRecipes)
	mux.HandleFunc("GET /recipes/{id}", h.getRecipe)
	mux.HandleFunc("GET /catalog", h.listCatalog)
	mux.HandleFunc("DELETE /recipes/{id}", h.deleteRecipe)
	mux.HandleFunc("PUT /recipes/{id}", h.updateRecipe)
	mux.HandleFunc("POST /recipes/import", h.importRecipe)
	mux.HandleFunc("POST /grocery-list", h.groceryList)
	return requireService(secret, mux)
}
```

Change the handlers struct:

```go
type handlers struct {
	store    Store
	importer *Importer
}
```

Add the handler method (and ensure `handler.go` imports `errors` — it already does):

```go
func (h *handlers) importRecipe(w http.ResponseWriter, r *http.Request) {
	if h.importer == nil {
		writeError(w, http.StatusServiceUnavailable, "import is not configured")
		return
	}
	var req struct {
		URL string `json:"url"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	if strings.TrimSpace(req.URL) == "" {
		writeError(w, http.StatusBadRequest, "url is required")
		return
	}
	rec, err := h.importer.Import(r.Context(), userIDFrom(r.Context()), req.URL)
	switch {
	case errors.Is(err, ErrImportBadURL):
		writeError(w, http.StatusBadRequest, "invalid or disallowed url")
	case errors.Is(err, ErrImportFetch):
		writeError(w, http.StatusBadGateway, "could not fetch the url")
	case errors.Is(err, ErrImportUnparseable):
		writeError(w, http.StatusUnprocessableEntity, "could not extract a recipe from this page; enter it manually")
	case err != nil:
		writeError(w, http.StatusInternalServerError, "could not import recipe")
	default:
		writeJSON(w, http.StatusOK, rec)
	}
}
```

Wire the importer in `cmd/server/main.go`, replacing line 47 (`handler := recipe.NewRouter(store, secret)`):

```go
	var extractor recipe.Extractor
	if apiKey := os.Getenv("ANTHROPIC_API_KEY"); apiKey != "" {
		extractor = recipe.NewClaudeExtractor(apiKey)
		log.Print("recipe import: LLM fallback enabled")
	} else {
		log.Print("recipe import: ANTHROPIC_API_KEY unset; LLM fallback disabled")
	}
	importer := recipe.NewImporter(recipe.NewHTTPFetcher(), extractor)
	handler := recipe.NewRouterWithImporter(store, secret, importer)
```

Add `ANTHROPIC_API_KEY` to `apps/recipe-service/.env.example`:

```
PORT=8090
DATABASE_URL=postgres://pantry:pantry@postgres:5432/pantry?sslmode=disable
# Optional. When set, enables the Claude fallback for URL import of pages
# without schema.org Recipe JSON-LD. Unset = JSON-LD-only import.
ANTHROPIC_API_KEY=
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/recipe-service && go build ./... && go test ./...`
Expected: PASS (all packages, including the untouched existing tests).

- [ ] **Step 5: Commit**

```bash
git add apps/recipe-service/internal/recipe/handler.go apps/recipe-service/internal/recipe/handler_test.go apps/recipe-service/cmd/server/main.go apps/recipe-service/.env.example
git commit -m "feat(recipe-import): POST /recipes/import endpoint + server wiring"
```

---

### Task 7: Shared type + Convex import action

Add the request type to the shared contract and a Convex action that proxies to `POST /recipes/import`.

**Files:**
- Modify: `packages/types/src/index.ts`
- Modify: `packages/convex/convex/recipes.ts`

**Interfaces:**
- Consumes: existing `recipeServiceFetch`, `Recipe` type, `getAuthUserId`.
- Produces: `ImportRecipeRequest` type; Convex action `api.recipes.importFromUrl({ url })` → `Recipe`.

- [ ] **Step 1: Add the shared type**

Append to `packages/types/src/index.ts`:

```ts
export interface ImportRecipeRequest {
  url: string;
}
```

- [ ] **Step 2: Add the Convex action**

Append to `packages/convex/convex/recipes.ts` (after the `update` action; it reuses the file's existing `recipeServiceFetch` and imports):

```ts
// Imports a recipe from a URL: recipe-service fetches + parses the page and
// returns a PREVIEW recipe (no id, not persisted). The web app drops it into the
// recipe form; the user reviews and saves via the normal create action.
export const importFromUrl = action({
  args: { url: v.string() },
  handler: async (ctx, { url }): Promise<Recipe> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    return recipeServiceFetch<Recipe>(userId, "POST", "/recipes/import", { url });
  },
});
```

- [ ] **Step 3: Type-check both packages**

Run: `pnpm --filter @pantry/types build && pnpm --filter @pantry/convex exec tsc -p . --noEmit`
Expected: no type errors. (If the convex package uses a different check script, run that package's `lint`/`typecheck` task instead — match the script names in its `package.json`.)

- [ ] **Step 4: Commit**

```bash
git add packages/types/src/index.ts packages/convex/convex/recipes.ts
git commit -m "feat(recipe-import): shared ImportRecipeRequest type + importFromUrl action"
```

> Note: the existing recipe-service proxy actions (`create`, `list`, …) have no runtime unit tests (they call `fetch`); `importFromUrl` follows that established pattern and is covered by type-checking here and by the web component test in Task 8.

---

### Task 8: Web — URL import in the recipe form

Add a URL field + "Import" button to `RecipeForm`. On import, call `importFromUrl`, then populate the form's title and ingredient state from the returned preview so the user can review and save through the existing create flow.

**Files:**
- Modify: `apps/web/src/components/RecipeForm.tsx`
- Create: `apps/web/src/components/RecipeForm.test.tsx`

**Interfaces:**
- Consumes: `api.recipes.importFromUrl`, `api.recipes.create`, `useAction`, `useAsyncAction`, `Recipe`/`Ingredient` types, existing `Button`/`Input`/`Card`/`ErrorText` UI.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/src/components/RecipeForm.test.tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@pantry/convex/api", () => ({
  api: {
    recipes: { create: "recipes.create", importFromUrl: "recipes.importFromUrl" },
  },
}));

const { createMock, importMock } = vi.hoisted(() => ({
  createMock: vi.fn(() => Promise.resolve({ id: "r1" })),
  importMock: vi.fn(),
}));

vi.mock("convex/react", () => ({
  // useAction is called with the api function reference; dispatch by it.
  useAction: (ref: string) => (ref === "recipes.importFromUrl" ? importMock : createMock),
}));

import { RecipeForm } from "./RecipeForm";

describe("RecipeForm import", () => {
  beforeEach(() => vi.clearAllMocks());

  it("imports a recipe and populates the form fields", async () => {
    importMock.mockResolvedValue({
      id: "",
      userId: "u1",
      title: "Garlic Bread",
      ingredients: [{ quantity: 2, unit: "clove", item: "garlic", note: "minced" }],
      createdAt: "",
    });

    render(<RecipeForm onCreated={() => {}} />);

    fireEvent.change(screen.getByPlaceholderText(/paste a recipe url/i), {
      target: { value: "https://example.com/garlic-bread" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^import$/i }));

    await waitFor(() =>
      expect(importMock).toHaveBeenCalledWith({ url: "https://example.com/garlic-bread" }),
    );
    // Title field is populated from the preview.
    await waitFor(() =>
      expect(screen.getByDisplayValue("Garlic Bread")).toBeInTheDocument(),
    );
    // Ingredient item is populated too.
    expect(screen.getByDisplayValue("garlic")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test -- RecipeForm`
Expected: FAIL — the URL field / import button don't exist yet.

- [ ] **Step 3: Implement the import UI**

Edit `apps/web/src/components/RecipeForm.tsx` to add import state and a URL row. Full updated component:

```tsx
import { api } from "@pantry/convex/api";
import type { Ingredient, Recipe } from "@pantry/types";
import { useAction } from "convex/react";
import { useState } from "react";
import { useAsyncAction } from "../lib/useAsyncAction";
import { ErrorText } from "./ErrorText";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { Input } from "./ui/Input";

const emptyIngredient = (): Ingredient => ({ quantity: 1, unit: "", item: "" });

export function RecipeForm({ onCreated }: { onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [ingredients, setIngredients] = useState<Ingredient[]>([emptyIngredient()]);
  const [url, setUrl] = useState("");
  const createRecipe = useAction(api.recipes.create);
  const importFromUrl = useAction(api.recipes.importFromUrl);
  const { run, error, pending } = useAsyncAction();
  const importAction = useAsyncAction();

  function update(i: number, patch: Partial<Ingredient>) {
    setIngredients((prev) => prev.map((ing, idx) => (idx === i ? { ...ing, ...patch } : ing)));
  }

  async function importUrl() {
    if (!url.trim()) return;
    const preview = (await importAction.run(() =>
      importFromUrl({ url: url.trim() }),
    )) as Recipe | undefined;
    if (preview) {
      setTitle(preview.title);
      setIngredients(preview.ingredients.length ? preview.ingredients : [emptyIngredient()]);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    const created = await run(() =>
      createRecipe({
        title: title.trim(),
        ingredients: ingredients.filter((ing) => ing.item.trim() !== ""),
      }),
    );
    if (created) {
      setTitle("");
      setIngredients([emptyIngredient()]);
      setUrl("");
      onCreated();
    }
  }

  return (
    <Card title="New recipe">
      <div className="mb-3 flex gap-2">
        <Input
          placeholder="Paste a recipe URL to import…"
          className="flex-1"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <Button
          variant="ghost"
          size="sm"
          onClick={importUrl}
          disabled={importAction.pending}
        >
          {importAction.pending ? "Importing…" : "Import"}
        </Button>
      </div>
      <ErrorText message={importAction.error} />
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <div className="flex flex-col gap-2">
          {ingredients.map((ing, i) => (
            <div key={i} className="flex gap-2">
              <Input
                type="number"
                className="w-16"
                value={ing.quantity}
                onChange={(e) => update(i, { quantity: Number(e.target.value) })}
              />
              <Input
                placeholder="unit"
                className="w-24"
                value={ing.unit}
                onChange={(e) => update(i, { unit: e.target.value })}
              />
              <Input
                placeholder="item"
                className="flex-1"
                value={ing.item}
                onChange={(e) => update(i, { item: e.target.value })}
              />
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIngredients((p) => [...p, emptyIngredient()])}
          >
            + ingredient
          </Button>
          <Button type="submit" disabled={pending} className="ml-auto">
            {pending ? "Saving…" : "Create recipe"}
          </Button>
        </div>
        <ErrorText message={error} />
      </form>
    </Card>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web test -- RecipeForm`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/RecipeForm.tsx apps/web/src/components/RecipeForm.test.tsx
git commit -m "feat(recipe-import): URL import UI in the recipe form"
```

---

### Task 9: Env passthrough + doc updates

Pass `ANTHROPIC_API_KEY` through docker-compose and record the new endpoint/config in the docs.

**Files:**
- Modify: `docker-compose.yml` (recipe-service `environment:` block, ~line 24)
- Modify: `docs/superpowers/specs/2026-07-12-url-import-recipe-parser-design.md` (reflect the stdlib/package/router deviations)

- [ ] **Step 1: Pass the key through compose**

In `docker-compose.yml`, under the `recipe-service` service's `environment:` block (after `RECIPE_SERVICE_SECRET`), add:

```yaml
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY:-}
```

(The `:-` default makes it optional — compose won't error when the variable is unset, matching the graceful-degradation contract.)

- [ ] **Step 2: Reconcile the spec with the implemented deviations**

In `docs/superpowers/specs/2026-07-12-url-import-recipe-parser-design.md`, update the `llm` component and the "Where it lives" section to state: the Claude call uses stdlib `net/http` (not `anthropic-sdk-go`) to honor the service's no-new-dependency constraint; import code lives in `package recipe` as `import_*.go` files; and the router adds `NewRouterWithImporter` alongside `NewRouter`. (These are already captured in the plan's Global Constraints — mirror that wording.)

- [ ] **Step 3: Full verification**

Run:
```bash
cd apps/recipe-service && go vet ./... && go test ./... && cd -
pnpm --filter web test -- RecipeForm
```
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml docs/superpowers/specs/2026-07-12-url-import-recipe-parser-design.md
git commit -m "chore(recipe-import): compose env passthrough + spec reconciliation"
```

---

## Self-Review

**Spec coverage:**
- URL → structured recipe → editable preview → save: Tasks 5 (importer preview), 6 (endpoint), 8 (web form populate + existing save). ✓
- JSON-LD first, LLM fallback: Tasks 2, 4, 5. ✓
- Deterministic line parser runs on the JSON-LD path: Tasks 1, 5. ✓
- Fetcher with scheme allowlist / timeout / size cap / SSRF guard: Task 3. ✓
- LLM behind an interface; nil when `ANTHROPIC_API_KEY` unset → 422/disabled: Tasks 4, 5, 6. ✓
- Preview never persisted; save via existing `POST /recipes`: Tasks 5 (no id, not stored), 8 (reuse create). ✓
- Convex proxy with service secret: Task 7. ✓
- Steps extracted but not persisted: `extractJSONLD`/`ExtractedRecipe` carry `Steps`; `Importer` ignores them for the saved `Recipe`. ✓
- Contract mirrored in TS + Go: Task 7 (`ImportRecipeRequest`) + Task 6 (`{url}` request struct). ✓
- Config + graceful degradation + no live Claude calls in tests: Tasks 4 (httptest), 6, 9. ✓
- Non-goals (persist steps, batch, browser parse, images): out of scope, not implemented. ✓

**Placeholder scan:** No "TBD"/"add error handling"/"similar to Task N" — every code step is complete and self-contained. ✓

**Type consistency:** `parseIngredientLine`, `extractJSONLD`/`jsonLDRecipe`, `Fetcher`/`NewHTTPFetcher`, `Extractor`/`ExtractedRecipe`/`NewClaudeExtractor`, `Importer`/`NewImporter`/`Import`, `NewRouterWithImporter`, `fakeFetcher`/`fakeExtractor`, `ImportRecipeRequest`, `importFromUrl` — names and signatures are used identically across the tasks that define and consume them. Error sentinels `ErrImportBadURL`/`ErrImportFetch`/`ErrImportUnparseable` are defined once (Task 3/`import_fetch.go`) and referenced by Tasks 5 and 6. ✓
