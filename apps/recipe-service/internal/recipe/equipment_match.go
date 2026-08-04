package recipe

import "sort"

// maxEquipmentUnlocks caps the "new to your kitchen" list. Discovery is a
// highlight reel — a hundred rows is not a moment of delight — and unlike the
// classification map below, this list carries whole recipe bodies. The counts
// are computed before the cap so the cap never distorts them.
const maxEquipmentUnlocks = 20

// EquipmentFitStatus says whether a recipe's hardware requirements are met.
//
// The third value is the point of the type. A recipe carrying no equipment tags
// has never been assessed — imports whose steps mentioned no known hardware, and
// every recipe typed in by hand, land there. Collapsing that into "makeable"
// would present missing data as a green light, so it stays its own answer and
// the UI is expected to say "we don't know" rather than "yes".
type EquipmentFitStatus string

const (
	FitMakeable EquipmentFitStatus = "makeable"
	FitBlocked  EquipmentFitStatus = "blocked"
	FitUnknown  EquipmentFitStatus = "unknown"
)

// EquipmentMatch is a recipe plus how it fares against one inventory. It embeds
// Recipe, so a match decodes as an ordinary recipe with a few extra fields.
type EquipmentMatch struct {
	Recipe
	Status EquipmentFitStatus `json:"status"`
	// Missing lists the *required* equipment the inventory lacks, sorted. Empty
	// unless Status is blocked.
	Missing []string `json:"missing"`
	// UnlockedBy names which of the newly acquired devices this recipe needed.
	// Only populated on a discovery query; empty otherwise.
	UnlockedBy []string `json:"unlockedBy"`
}

// EquipmentCounts summarises a whole recipe set. `Unknown` is reported rather
// than folded into either other bucket: it is how much the app cannot answer,
// and the UI has to be able to say so.
type EquipmentCounts struct {
	Makeable int `json:"makeable"`
	Blocked  int `json:"blocked"`
	Unknown  int `json:"unknown"`
}

// EquipmentMatchResult is the response body of POST /equipment/match.
//
// Counts always describe every recipe considered, even when Recipes has been
// narrowed to a discovery list or truncated — a denominator that shrinks with
// the filter would make "3 recipes we can't assess" meaningless.
type EquipmentMatchResult struct {
	Recipes []EquipmentMatch `json:"recipes"`
	Counts  EquipmentCounts  `json:"counts"`
}

// ownedSet turns an inventory into a lookup, dropping slugs outside the curated
// catalog. Inventory rows are written by Convex, which deliberately does not
// carry a copy of the catalog, so a slug retired from equipment.json can survive
// in a user's inventory. Such a slug satisfies nothing — silently ignoring it
// degrades one stale row instead of failing the entire screen.
func ownedSet(owned []string) map[string]bool {
	set := make(map[string]bool, len(owned))
	for _, id := range owned {
		if equipmentCatalog.HasEquipment(id) {
			set[id] = true
		}
	}
	return set
}

// ClassifyRecipe answers "can I make this?" for one recipe against one
// inventory, and names the required equipment that is missing.
//
// Optional tags ("a grill pan works too") never block: BL-0043 flags and
// filters, it never hides a recipe, because borrowing a friend's smoker is a
// normal thing to do.
func ClassifyRecipe(rec Recipe, owned map[string]bool) (EquipmentFitStatus, []string) {
	if len(rec.Equipment) == 0 {
		return FitUnknown, []string{}
	}
	missing := []string{}
	for _, e := range rec.Equipment {
		if e.Required && !owned[e.ID] {
			missing = append(missing, e.ID)
		}
	}
	if len(missing) == 0 {
		return FitMakeable, []string{}
	}
	sort.Strings(missing)
	return FitBlocked, missing
}

// statusRank orders the buckets for display: what you can cook now, then what
// we can't assess, then what you're missing hardware for.
func statusRank(s EquipmentFitStatus) int {
	switch s {
	case FitMakeable:
		return 0
	case FitUnknown:
		return 1
	default:
		return 2
	}
}

// MatchRecipes classifies every recipe against `owned`.
//
// When `acquired` is non-empty this becomes the new-device query: the result is
// narrowed to recipes the new hardware genuinely unlocked — makeable now, and
// blocked without it. A recipe that merely *mentions* the device optionally was
// always makeable and is not news; an untagged recipe can never be claimed as
// unlocked, since nothing is known about what it needs.
func MatchRecipes(recs []Recipe, owned, acquired []string) EquipmentMatchResult {
	ownedIDs := ownedSet(owned)
	// The counterfactual inventory: what the user had before the new devices.
	before := make(map[string]bool, len(ownedIDs))
	for id := range ownedIDs {
		before[id] = true
	}
	acquiredIDs := map[string]bool{}
	for _, id := range acquired {
		if ownedIDs[id] {
			acquiredIDs[id] = true
			delete(before, id)
		}
	}
	discovery := len(acquiredIDs) > 0

	out := []EquipmentMatch{}
	counts := EquipmentCounts{}
	for _, rec := range recs {
		status, missing := ClassifyRecipe(rec, ownedIDs)
		switch status {
		case FitMakeable:
			counts.Makeable++
		case FitBlocked:
			counts.Blocked++
		default:
			counts.Unknown++
		}

		unlockedBy := []string{}
		if discovery {
			if status != FitMakeable {
				continue
			}
			if wasBlocked, _ := ClassifyRecipe(rec, before); wasBlocked != FitBlocked {
				continue
			}
			for _, e := range rec.Equipment {
				if e.Required && acquiredIDs[e.ID] {
					unlockedBy = append(unlockedBy, e.ID)
				}
			}
			sort.Strings(unlockedBy)
		}
		out = append(out, EquipmentMatch{
			Recipe:     rec,
			Status:     status,
			Missing:    missing,
			UnlockedBy: unlockedBy,
		})
	}

	sort.SliceStable(out, func(i, j int) bool {
		if ri, rj := statusRank(out[i].Status), statusRank(out[j].Status); ri != rj {
			return ri < rj
		}
		return out[i].Title < out[j].Title
	})
	if discovery && len(out) > maxEquipmentUnlocks {
		out = out[:maxEquipmentUnlocks]
	}
	return EquipmentMatchResult{Recipes: out, Counts: counts}
}
