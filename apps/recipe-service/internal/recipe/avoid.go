package recipe

import (
	"sort"
	"strings"
)

// What an avoid-list entry turned out to be. The three cases are meaningfully
// different to the user, which is why the kind travels to the client rather than
// being flattened into "here is a string we stored".
const (
	// AvoidKindAllergen — the entry named a whole allergen family, and avoiding
	// it excludes every member.
	AvoidKindAllergen = "allergen"
	// AvoidKindItem — the entry resolved to one canonical ingredient.
	AvoidKindItem = "item"
	// AvoidKindUnknown — the dictionary has never heard of this text. The entry
	// is still storable, but it will match no recipe, and saying so is the whole
	// point of this endpoint: an avoid entry that silently filters nothing is
	// the bug (BL-0052), and for a declared allergy it is not a cosmetic one.
	AvoidKindUnknown = "unknown"
)

// AvoidResolution is what one avoid-list entry resolved to. It is the wire shape
// of POST /normalization/avoid.
//
// Input is echoed back because the response is what lets a client say "scallion
// → green onion". The endpoint answers each entry independently and in order —
// unlike /normalization/lookup, which collapses duplicates and therefore cannot
// tell a caller what any PARTICULAR entry became.
type AvoidResolution struct {
	Input string `json:"input"`
	// CanonicalItem is what to store: a canonical item key, an allergen family
	// key, or — for an unknown entry — the normalized text itself, so the entry
	// survives to be re-resolved once the dictionary learns the word.
	CanonicalItem string `json:"canonicalItem"`
	Display       string `json:"display"`
	Kind          string `json:"kind"`
	// Members are the display names of every ingredient an allergen family
	// excludes, sorted. Populated only for AvoidKindAllergen. The family is a
	// coarse grouping the user never chose, so it has to be inspectable: this is
	// the same rule diet seeds already follow — nothing is excluded invisibly.
	Members []string `json:"members,omitempty"`
	// Families names the allergen families a single ITEM belongs to, if any. It
	// is a nudge rather than a filter: someone avoiding "peanut butter" probably
	// wants "peanut", and this is what lets the client offer that.
	Families []string `json:"families,omitempty"`
}

// ResolveAvoid resolves one raw avoid-list entry.
//
// Allergen family names are checked BEFORE items, and that order is deliberate.
// Several family names ("egg", "milk", "peanut") are also canonical item keys,
// and reading them as the single item is the failure mode this exists to fix: a
// user typing "milk" into a list whose stated job is removing recipes means
// dairy far more often than they mean the carton. Preferring the family errs
// toward excluding too much, which for an allergen is the survivable direction —
// and the members come back with the answer, so the user can see exactly what
// they got and pick the specific item instead.
func (n *Normalizer) ResolveAvoid(raw string) (AvoidResolution, bool) {
	norm := strings.ToLower(strings.TrimSpace(raw))
	if norm == "" {
		return AvoidResolution{}, false
	}
	res := AvoidResolution{Input: strings.TrimSpace(raw)}

	if family, ok := n.allergenFamily(norm); ok {
		def := n.data.Allergens[family]
		res.CanonicalItem = family
		res.Display = def.Display
		res.Kind = AvoidKindAllergen
		res.Members = n.allergenMembers(family)
		return res, true
	}

	d := n.Details(norm)
	res.CanonicalItem = d.CanonicalItem
	res.Display = d.Display
	if !d.Known {
		res.Kind = AvoidKindUnknown
		return res, true
	}
	res.Kind = AvoidKindItem
	res.Families = d.Allergens
	return res, true
}

// allergenFamily matches family names the way item lookup matches item names:
// literally first, then the same guarded plural fold, so "peanuts" finds the
// peanut family without the table having to list every inflection.
func (n *Normalizer) allergenFamily(norm string) (string, bool) {
	if family, ok := n.allergenByName[norm]; ok {
		return family, true
	}
	for _, cand := range singularCandidates(norm) {
		if family, ok := n.allergenByName[cand]; ok {
			return family, true
		}
	}
	return "", false
}

// allergenMembers lists a family's members by DISPLAY name, sorted. Display
// rather than canonical key because this list is read by a person deciding
// whether the family is what they meant.
func (n *Normalizer) allergenMembers(family string) []string {
	def, ok := n.data.Allergens[family]
	if !ok {
		return nil
	}
	out := make([]string, 0, len(def.Items))
	for _, item := range def.Items {
		if it, known := n.data.Items[item]; known {
			out = append(out, it.Display)
		}
	}
	sort.Strings(out)
	return out
}
