package recommend

import (
	"fmt"
	"strings"
)

// maxNamedItems caps how many ingredients a reason names before it summarizes.
const maxNamedItems = 3

// pantryReasons renders the winning features as human strings, most important
// first. The UI shows the top two or three, so ordering here is the ranking of
// what matters: what you asked to use up, then how much you already have.
func pantryReasons(m match) []string {
	var out []string

	if len(m.useItUpHit) > 0 {
		named := m.useItUpHit
		if len(named) > maxNamedItems {
			named = named[:maxNamedItems]
		}
		out = append(out, "Uses up: "+strings.Join(named, ", "))
	}

	switch {
	case len(m.missing) == 0 && len(m.have) > 0:
		out = append(out, "You have everything")
	case len(m.have) == 1:
		out = append(out, "Uses 1 thing you have")
	case len(m.have) > 1:
		out = append(out, fmt.Sprintf("Uses %d things you have", len(m.have)))
	}

	if n := len(m.missing); n > 0 && n <= 2 {
		out = append(out, fmt.Sprintf("You need %d more", n))
	}

	return out
}
