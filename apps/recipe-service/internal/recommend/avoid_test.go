package recommend

import "testing"

// The avoid list is the one place in this feature where being wrong has
// real-world consequences, so these tests exercise the property the feature
// claims — "a recipe containing something I avoid never appears" — rather than
// the identity case where the entry and the ingredient are the same literal
// string. That case passes even when nothing is canonicalized at all, which is
// exactly how the gap BL-0052 closes stayed invisible.

// allergenCand is cand() plus family membership on chosen ingredients, the way
// the recipe package attaches it from the normalization dictionary.
func allergenCand(id, title string, families map[string][]string, items ...string) Candidate {
	c := cand(id, title, items...)
	for i := range c.Ingredients {
		c.Ingredients[i].Allergens = families[c.Ingredients[i].CanonicalItem]
	}
	return c
}

// The headline case. "peanut" is a canonical item in its own right, so an exact
// match on the key removes a recipe calling for peanuts and leaves one calling
// for peanut butter — which is the failure a declared allergy cannot survive.
func TestAvoidedAllergenFamilyRemovesItsMembers(t *testing.T) {
	uc := UserContext{
		Pantry:      have("rice", "bread"),
		Preferences: Preferences{AvoidItems: []string{"peanut"}},
	}
	families := map[string][]string{
		"peanut butter": {"peanut"},
		"peanut":        {"peanut"},
	}
	got := RankPantry(uc, []Candidate{
		allergenCand("sandwich", "PB sandwich", families, "peanut butter", "bread"),
		allergenCand("satay", "Satay", families, "peanut", "rice"),
		allergenCand("plain", "Plain rice", families, "rice"),
	})
	eq(t, ids(got), []string{"plain"})
}

// An ingredient can be in more than one family, and matching ANY of them has to
// remove the recipe: egg noodles are both egg and wheat, and someone avoiding
// eggs is not helped by the fact that the pasta arm would also have caught it.
func TestAvoidedFamilyMatchesAnyOfAnIngredientsFamilies(t *testing.T) {
	families := map[string][]string{"egg noodles": {"egg", "wheat"}}
	for _, family := range []string{"egg", "wheat"} {
		uc := UserContext{
			Pantry:      have("chicken stock"),
			Preferences: Preferences{AvoidItems: []string{family}},
		}
		got := RankPantry(uc, []Candidate{
			allergenCand("soup", "Noodle soup", families, "egg noodles", "chicken stock"),
			allergenCand("broth", "Broth", families, "chicken stock"),
		})
		eq(t, ids(got), []string{"broth"})
	}
}

// The family arm must not become a blanket. Avoiding a family removes only its
// members; an ingredient in NO family, and one in a different family, both stay.
func TestAvoidedFamilyLeavesNonMembersAlone(t *testing.T) {
	uc := UserContext{
		Pantry:      have("rice", "tofu", "shrimp"),
		Preferences: Preferences{AvoidItems: []string{"peanut"}},
	}
	families := map[string][]string{
		"peanut butter": {"peanut"},
		"tofu":          {"soy"},
		"shrimp":        {"shellfish"},
	}
	got := RankPantry(uc, []Candidate{
		allergenCand("stirfry", "Tofu stir fry", families, "tofu", "rice"),
		allergenCand("scampi", "Shrimp scampi", families, "shrimp", "rice"),
		allergenCand("satay", "Satay", families, "peanut butter", "rice"),
	})
	eq(t, ids(got), []string{"scampi", "stirfry"})
}

// A canonicalized entry has to reach an ingredient stored under the canonical
// key even though the user typed a synonym. Canonicalization happens on write
// (Convex resolves the entry through the dictionary), so what arrives here is
// the pair that used to miss: entry "green onion", ingredient "green onion",
// user text "scallion". The regression this guards is a stored raw "scallion",
// which matches nothing.
func TestAvoidedEntryIsMatchedOnTheCanonicalKeyNotTypedText(t *testing.T) {
	uc := UserContext{
		Pantry:      have("green onion", "rice"),
		Preferences: Preferences{AvoidItems: []string{"green onion"}},
	}
	got := RankPantry(uc, []Candidate{
		cand("fried-rice", "Fried rice", "green onion", "rice"),
		cand("plain", "Plain rice", "rice"),
	})
	eq(t, ids(got), []string{"plain"})

	// And the uncanonicalized form must be the thing that fails, so this test
	// cannot pass for the wrong reason.
	raw := UserContext{
		Pantry:      have("green onion", "rice"),
		Preferences: Preferences{AvoidItems: []string{"scallion"}},
	}
	gotRaw := RankPantry(raw, []Candidate{
		cand("fried-rice", "Fried rice", "green onion", "rice"),
		cand("plain", "Plain rice", "rice"),
	})
	if len(gotRaw) != 2 {
		t.Fatalf("raw entry filtered something: %v — the ranker matches canonical keys "+
			"only, so canonicalization must happen before the entry is stored", ids(gotRaw))
	}
}

// An unknown ingredient carries no families, and must not be swept up by an
// avoid entry for one. Unrecognized text is reported to the user as unmatched
// (BL-0052); guessing at its allergens here would be a different lie.
func TestUnknownIngredientIsNotMatchedByAFamily(t *testing.T) {
	uc := UserContext{
		Pantry:      have("rice"),
		Preferences: Preferences{AvoidItems: []string{"peanut"}},
	}
	got := RankPantry(uc, []Candidate{
		allergenCand("mystery", "Mystery bowl", nil, "unobtainium", "rice"),
	})
	eq(t, ids(got), []string{"mystery"})
}
