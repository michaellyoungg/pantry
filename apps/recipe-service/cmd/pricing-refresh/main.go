// Command pricing-refresh updates internal/pricing/bls_snapshot.json from the
// BLS Public Data API.
//
// It is deliberately a CLI a human (or a monthly CI job) runs, not something the
// server does at runtime: serving a grocery list must never depend on BLS being
// up, and a price change should land as a reviewable diff rather than appear
// silently in production.
//
// BLS_API_KEY is optional. The public API answers without a registration key at
// a lower daily quota, so a fresh clone can refresh with no credential at all;
// set the env var to use the higher registered tier.
//
//	go run ./cmd/pricing-refresh
//
// Only prices move. A series' title, dimension and pack size are stable
// metadata that BLS does not revise, so they are preserved from the existing
// snapshot rather than re-fetched — which also keeps the refresh dependent on
// api.bls.gov alone. Adding a new series to pricing_map.json is the one case
// that needs that metadata, so pass a locally downloaded copy of the AP series
// catalog:
//
//	curl -o ap.series https://download.bls.gov/pub/time.series/ap/ap.series
//	go run ./cmd/pricing-refresh -catalog ap.series
//
// (That download host applies an opaque User-Agent filter that rejects most
// programmatic clients, which is exactly why fetching it is manual and
// occasional rather than wired into this tool.)
package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"pantry/apps/recipe-service/internal/pricing"
)

const (
	apiURL     = "https://api.bls.gov/publicAPI/v2/timeseries/data/"
	sourceName = "U.S. Bureau of Labor Statistics, CPI Average Price Data (AP)"
	sourceURL  = "https://www.bls.gov/cpi/data.htm"
	areaName   = "U.S. city average"

	// The unregistered tier allows fewer series per request than the registered
	// one; chunk conservatively unless a key is present.
	chunkKeyless = 25
	chunkKeyed   = 50

	// userAgent identifies this client to BLS rather than pretending to be a
	// browser. api.bls.gov accepts it; the separate download host does not,
	// which is why the series catalog is supplied manually via -catalog.
	userAgent = "pantry-pricing-refresh/1.0 (+https://github.com/michaellyoungg/pantry)"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "pricing-refresh:", err)
		os.Exit(1)
	}
}

func run() error {
	path := flag.String("out", "internal/pricing/bls_snapshot.json", "snapshot to read metadata from and write prices to")
	catalog := flag.String("catalog", "", "optional local copy of the BLS ap.series catalog, used to derive pack metadata for series not already in the snapshot")
	years := flag.Int("years", 2, "how many years of data to request (the latest usable value wins)")
	flag.Parse()

	mapping, err := pricing.EmbeddedMapping()
	if err != nil {
		return err
	}
	ids := mappedSeriesIDs(mapping)
	if len(ids) == 0 {
		return errors.New("pricing_map.json references no series")
	}
	fmt.Fprintf(os.Stderr, "resolving %d series referenced by pricing_map.json\n", len(ids))

	existing, err := readSnapshot(*path)
	if err != nil {
		return err
	}
	titles, err := readCatalog(*catalog)
	if err != nil {
		return fmt.Errorf("catalog %s: %w", *catalog, err)
	}

	key := os.Getenv("BLS_API_KEY")
	if key == "" {
		fmt.Fprintln(os.Stderr, "BLS_API_KEY unset — using the unregistered public tier")
	}
	client := &http.Client{Timeout: 60 * time.Second}
	values, err := fetchLatestValues(client, ids, key, *years)
	if err != nil {
		return fmt.Errorf("api: %w", err)
	}

	snap := pricing.Snapshot{
		Source:    sourceName,
		SourceURL: sourceURL,
		Area:      areaName,
		FetchedAt: time.Now().UTC().Format("2006-01-02"),
		Series:    map[string]pricing.Series{},
	}
	var newest string
	for _, id := range ids {
		obs, ok := values[id]
		if !ok {
			return fmt.Errorf("series %s: no usable observation returned", id)
		}
		ser, err := seriesMetadata(id, existing, titles)
		if err != nil {
			return err
		}
		ser.Value, ser.Month = obs.value, obs.month
		snap.Series[id] = ser
		if obs.month > newest {
			newest = obs.month
		}
	}
	snap.ObservationMonth = newest

	// A table where some series lag the headline month badly would make the
	// displayed "as of" label a lie. Warn loudly rather than silently shipping it.
	for id, s := range snap.Series {
		if s.Month != newest {
			fmt.Fprintf(os.Stderr, "warning: %s is from %s, headline month is %s\n", id, s.Month, newest)
		}
	}

	// Round-trip through the loader so a snapshot that would fail at server
	// startup fails here instead.
	blob, err := json.MarshalIndent(snap, "", "  ")
	if err != nil {
		return err
	}
	blob = append(blob, '\n')
	if _, err := pricing.NewEstimator(mustLoad(blob), mapping); err != nil {
		return fmt.Errorf("refusing to write an invalid snapshot: %w", err)
	}
	if err := os.WriteFile(*path, blob, 0o644); err != nil {
		return err
	}
	fmt.Fprintf(os.Stderr, "wrote %s: %d series, observation month %s\n", *path, len(snap.Series), newest)
	return nil
}

// seriesMetadata reuses the title, dimension and pack size already recorded for
// a series, falling back to the AP catalog for series being added for the first
// time. A series with neither is a hard error: guessing a pack size silently
// scales every price derived from it.
func seriesMetadata(id string, existing pricing.Snapshot, titles map[string]string) (pricing.Series, error) {
	if s, ok := existing.Series[id]; ok && s.PackSize > 0 && s.Dimension != "" {
		return s, nil
	}
	title, ok := titles[id]
	if !ok {
		return pricing.Series{}, fmt.Errorf(
			"series %s is new: no pack metadata in the snapshot and no -catalog supplied", id)
	}
	dim, packSize, err := parsePack(title)
	if err != nil {
		return pricing.Series{}, fmt.Errorf("series %s (%q): %w", id, title, err)
	}
	fmt.Fprintf(os.Stderr, "adding %s: %s (%s, pack %.4g)\n", id, shortTitle(title), dim, packSize)
	return pricing.Series{Title: shortTitle(title), Dimension: dim, PackSize: packSize}, nil
}

// readSnapshot loads the current snapshot for its metadata. A missing file is
// not an error — that is the bootstrap case, which needs -catalog.
func readSnapshot(path string) (pricing.Snapshot, error) {
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return pricing.Snapshot{Series: map[string]pricing.Series{}}, nil
	}
	if err != nil {
		return pricing.Snapshot{}, err
	}
	return pricing.LoadSnapshot(raw)
}

// readCatalog parses a local copy of the tab-separated BLS AP series catalog
// into series id -> title. An empty path yields an empty catalog.
func readCatalog(path string) (map[string]string, error) {
	titles := map[string]string{}
	if path == "" {
		return titles, nil
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer func() { _ = f.Close() }()

	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for first := true; sc.Scan(); first = false {
		if first {
			continue // header row
		}
		cols := strings.Split(sc.Text(), "\t")
		if len(cols) < 4 {
			continue
		}
		titles[strings.TrimSpace(cols[0])] = strings.TrimSpace(cols[3])
	}
	return titles, sc.Err()
}

func mustLoad(blob []byte) pricing.Snapshot {
	s, err := pricing.LoadSnapshot(blob)
	if err != nil {
		panic(err) // we just marshalled it
	}
	return s
}

func mappedSeriesIDs(m pricing.MappingFile) []string {
	seen := map[string]bool{}
	var ids []string
	for _, b := range m.Buckets {
		if !seen[b.SeriesID] {
			seen[b.SeriesID] = true
			ids = append(ids, b.SeriesID)
		}
	}
	sort.Strings(ids)
	return ids
}

type observation struct {
	month string
	value float64
}

type apiResponse struct {
	Status  string   `json:"status"`
	Message []string `json:"message"`
	Results struct {
		Series []struct {
			SeriesID string `json:"seriesID"`
			Data     []struct {
				Year   string `json:"year"`
				Period string `json:"period"`
				Value  string `json:"value"`
			} `json:"data"`
		} `json:"series"`
	} `json:"Results"`
}

// fetchLatestValues returns the most recent numeric monthly observation per
// series. Values can be "-" — October 2025 carries footnote X, "Data
// unavailable due to the 2025 lapse in appropriations" — so non-numeric
// observations are skipped rather than parsed as zero.
func fetchLatestValues(client *http.Client, ids []string, key string, years int) (map[string]observation, error) {
	chunk := chunkKeyless
	if key != "" {
		chunk = chunkKeyed
	}
	now := time.Now().UTC()
	out := map[string]observation{}

	for start := 0; start < len(ids); start += chunk {
		end := min(start+chunk, len(ids))
		body := map[string]any{
			"seriesid":  ids[start:end],
			"startyear": strconv.Itoa(now.Year() - years),
			"endyear":   strconv.Itoa(now.Year()),
		}
		if key != "" {
			body["registrationkey"] = key
		}
		blob, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		req, err := http.NewRequest(http.MethodPost, apiURL, bytes.NewReader(blob))
		if err != nil {
			return nil, err
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("User-Agent", userAgent)

		resp, err := client.Do(req)
		if err != nil {
			return nil, err
		}
		raw, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			return nil, err
		}
		if resp.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("POST %s: %s", apiURL, resp.Status)
		}
		var parsed apiResponse
		if err := json.Unmarshal(raw, &parsed); err != nil {
			return nil, fmt.Errorf("decode response: %w", err)
		}
		if parsed.Status != "REQUEST_SUCCEEDED" {
			return nil, fmt.Errorf("%s: %s", parsed.Status, strings.Join(parsed.Message, "; "))
		}
		for _, s := range parsed.Results.Series {
			for _, d := range s.Data {
				if !strings.HasPrefix(d.Period, "M") || d.Period == "M13" {
					continue // M13 is an annual average, not a month
				}
				v, err := strconv.ParseFloat(d.Value, 64)
				if err != nil || v <= 0 {
					continue // "-" for months BLS could not publish
				}
				month := d.Year + "-" + d.Period[1:]
				if cur, ok := out[s.SeriesID]; !ok || month > cur.month {
					out[s.SeriesID] = observation{month: month, value: v}
				}
			}
		}
	}
	return out, nil
}

// packRe pulls the pack size out of a BLS series title. Titles are formulaic:
// "per lb. (453.6 gm)", "per doz.", "per gal. (3.8 lit)", "per 1/2 gal. (1.9 lit)",
// "per 16 oz. (473.2 ml)", "per 2 liters (67.6 oz)", "per 16 oz.".
var packRe = regexp.MustCompile(`(?i)\bper ((?:\d+/\d+|\d+(?:\.\d+)?)\s+)?([a-z]+)\.?(?:\s*\((\d+(?:\.\d+)?)\s*(gm|ml|lit|liters?|oz)\))?`)

const (
	gramsPerPound = 453.592
	gramsPerOunce = 28.3495
	mlPerGallon   = 3785.41
	mlPerLitre    = 1000
	eggsPerDozen  = 12
)

// parsePack derives the dimension and base-unit pack size a series' price is
// quoted per. The parenthetical is what disambiguates fluid ounces from weight
// ounces: "per 8 oz. (226.8 gm)" is mass, "per 16 oz. (473.2 ml)" is volume.
func parsePack(title string) (pricing.Dimension, float64, error) {
	m := packRe.FindStringSubmatch(title)
	if m == nil {
		return "", 0, errors.New("no `per <unit>` clause in title")
	}
	qty, err := parseQuantity(strings.TrimSpace(m[1]))
	if err != nil {
		return "", 0, err
	}
	unit := strings.ToLower(m[2])
	parenVal, parenUnit := 0.0, strings.ToLower(m[4])
	if m[3] != "" {
		if parenVal, err = strconv.ParseFloat(m[3], 64); err != nil {
			return "", 0, fmt.Errorf("parenthetical size %q: %w", m[3], err)
		}
	}

	switch unit {
	case "lb", "lbs", "pound", "pounds":
		return pricing.DimensionMass, qty * gramsPerPound, nil
	case "gal", "gallon", "gallons":
		return pricing.DimensionVolume, qty * mlPerGallon, nil
	case "liter", "liters", "litre", "litres", "lit":
		return pricing.DimensionVolume, qty * mlPerLitre, nil
	case "doz", "dozen":
		return pricing.DimensionCount, qty * eggsPerDozen, nil
	case "oz", "ounce", "ounces":
		switch parenUnit {
		case "gm":
			return pricing.DimensionMass, parenVal, nil
		case "ml":
			return pricing.DimensionVolume, parenVal, nil
		case "lit", "liter", "liters":
			return pricing.DimensionVolume, parenVal * mlPerLitre, nil
		default:
			// No parenthetical: BLS uses bare ounces for weight (potato chips).
			return pricing.DimensionMass, qty * gramsPerOunce, nil
		}
	}
	// Unmapped unit (kwh, therm): fall back to the parenthetical if it is usable.
	switch parenUnit {
	case "gm":
		return pricing.DimensionMass, parenVal, nil
	case "ml":
		return pricing.DimensionVolume, parenVal, nil
	}
	return "", 0, fmt.Errorf("unsupported pack unit %q", unit)
}

// parseQuantity handles the plain and fractional forms BLS uses ("2", "1/2").
func parseQuantity(s string) (float64, error) {
	if s == "" {
		return 1, nil
	}
	if num, den, ok := strings.Cut(s, "/"); ok {
		n, err1 := strconv.ParseFloat(num, 64)
		d, err2 := strconv.ParseFloat(den, 64)
		if err1 != nil || err2 != nil || d == 0 {
			return 0, fmt.Errorf("bad fraction %q", s)
		}
		return n / d, nil
	}
	return strconv.ParseFloat(s, 64)
}

// shortTitle trims BLS's boilerplate suffix so the snapshot stays readable.
func shortTitle(title string) string {
	if i := strings.Index(title, " in U.S. city average"); i > 0 {
		return title[:i]
	}
	return title
}
