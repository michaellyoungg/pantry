// Command normalization-coverage reports how much ingredient text resolves to a
// canonical item, and names what did not.
//
// The dictionary in internal/recipe/normalization.json is the join key under the
// pantry, don't-rebuy, recommendations and nutrition gram resolution. A missing
// entry does not error — it silently produces an item that can never match — so
// the only way to keep it honest is to measure it and to look at the misses.
//
// Usage:
//
//	normalization-coverage                 # the seeded catalog that ships with the service
//	normalization-coverage lines.txt ...    # files of raw ingredient lines, one per line
//	normalization-coverage -json corpus.txt # machine-readable, for a dashboard or a diff
//	normalization-coverage -min 0.9 x.txt   # exit 1 below the threshold (CI gate)
//
// A lines file is read the way an import delivers text — "1/4 cup chopped fresh
// cilantro", not "cilantro" — so the number covers the whole path from scraped
// line to canonical item. Blank lines and lines starting with '#' are ignored,
// so a corpus can carry its own provenance.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"strings"

	"pantry/apps/recipe-service/internal/recipe"
)

func main() {
	asJSON := flag.Bool("json", false, "emit the report as JSON")
	min := flag.Float64("min", 0, "exit non-zero if coverage is below this share (0..1)")
	top := flag.Int("top", 40, "how many unresolved items to print (0 for all)")
	flag.Parse()

	report, label, err := measure(flag.Args())
	if err != nil {
		fmt.Fprintln(os.Stderr, "normalization-coverage:", err)
		os.Exit(2)
	}

	if *asJSON {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		if err := enc.Encode(report); err != nil {
			fmt.Fprintln(os.Stderr, "normalization-coverage:", err)
			os.Exit(2)
		}
	} else {
		printReport(report, label, *top)
	}

	// Below the floor is a real failure: it is how a dictionary regression gets
	// caught by a pipeline rather than by a user whose pantry stopped matching.
	if *min > 0 && report.Share < *min {
		fmt.Fprintf(os.Stderr, "coverage %.1f%% is below the required %.1f%%\n", report.Share*100, *min*100)
		os.Exit(1)
	}
}

// measure builds the report for whichever corpus the caller named, and returns a
// human label for it.
func measure(paths []string) (recipe.CoverageReport, string, error) {
	if len(paths) == 0 {
		r, err := recipe.CatalogCoverage()
		return r, "seeded catalog", err
	}
	var lines []string
	for _, p := range paths {
		raw, err := os.ReadFile(p)
		if err != nil {
			return recipe.CoverageReport{}, "", err
		}
		lines = append(lines, strings.Split(string(raw), "\n")...)
	}
	return recipe.CoverageOfLines(lines), strings.Join(paths, ", "), nil
}

func printReport(r recipe.CoverageReport, label string, top int) {
	fmt.Printf("%s: %d/%d ingredient lines resolve to a canonical item (%.1f%%)\n",
		label, r.Resolved, r.Lines, r.Share*100)
	if len(r.Unresolved) == 0 {
		fmt.Println("no unresolved ingredients")
		return
	}
	shown := r.Unresolved
	if top > 0 && len(shown) > top {
		shown = shown[:top]
	}
	fmt.Printf("\nunresolved, most frequent first (%d of %d shown):\n", len(shown), len(r.Unresolved))
	for _, u := range shown {
		line := fmt.Sprintf("  %4d  %s", u.Count, u.Item)
		if len(u.Examples) > 0 {
			line += "  — " + strings.Join(u.Examples, "; ")
		}
		fmt.Println(line)
	}
}
