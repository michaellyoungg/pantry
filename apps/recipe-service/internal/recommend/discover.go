package recommend

import "sort"

// --- The discovery surface (BL-0005 increment 2) -------------------------
//
// NOTE ON THE FILENAME: `discovery.go` beside this holds the FACET features
// (cuisineMatch, timeFit) that both surfaces score. This file holds the discover
// SURFACE — its own ranker, its own weights, its own filters.
//
// The two surfaces are separate code paths on purpose, and the reason is not
// tidiness: the intents pull in opposite directions. "Cook what I have" is
// convergent and rewards the familiar; "what should I try" is divergent and
// rewards the unfamiliar. Forcing both through one ranker would mean the same
// features carrying opposite weight signs, decided by a flag — which is two
// rankers wearing one name.
//
// What they DO share, and must: the hard filters. The avoid list and its
// allergen families (BL-0052) remove candidates here exactly as they do on the
// pantry surface, before anything is scored. A recommendation surface that can
// put an allergen on screen is a safety bug, and a second surface that filters
// slightly differently is how that bug gets shipped.

// RecipeInteraction is the recent event history for ONE recipe, already folded
// into counts by the caller.
//
// Counts, not events: the ranker has no business knowing when something happened
// or in what order. Convex owns the log and the recency window it reads from,
// and this package sees only the summary — which is what keeps it stateless.
type RecipeInteraction struct {
	// Shown is impressions on a recommendation surface. It is deliberately NOT a
	// taste signal (an impression is not an opinion); it feeds novelty only, so
	// that a small catalog does not show the same five cards forever.
	Shown int `json:"shown"`
	// Accepted is "put on the plan", Cooked is "actually made it".
	Accepted int `json:"accepted"`
	Cooked   int `json:"cooked"`
	// Dismissed is the user saying no. It REMOVES the candidate rather than
	// down-weighting it — see RankDiscover.
	Dismissed int `json:"dismissed"`
}

// nearDuplicateThreshold is how similar a candidate has to be to something the
// user already owns before the penalty engages at all.
//
// It is a THRESHOLD rather than a straight scaling of similarity because of what
// BL-0033 learned the hard way: an ungated similarity penalty fires on every
// pair — two recipes sharing salt and onion are "similar" — and quietly cancels
// out the signals it sits beside. Below the gate the penalty is exactly zero, so
// only a genuine near-copy pays it.
const nearDuplicateThreshold = 0.6

// jaccard is set overlap over set union for two canonical-ingredient sets.
// Empty on either side is 0: an ingredient-less recipe resembles nothing.
func jaccard(a, b map[string]bool) float64 {
	if len(a) == 0 || len(b) == 0 {
		return 0
	}
	var inter int
	for item := range a {
		if b[item] {
			inter++
		}
	}
	if inter == 0 {
		return 0
	}
	return float64(inter) / float64(len(a)+len(b)-inter)
}

// canonicalSet reduces a candidate to the distinct canonical items it uses.
func canonicalSet(c Candidate) map[string]bool {
	set := make(map[string]bool, len(c.Ingredients))
	for _, ing := range c.Ingredients {
		if ing.CanonicalItem != "" {
			set[ing.CanonicalItem] = true
		}
	}
	return set
}

// ownedCorpus is the ingredient fingerprint of everything the user already has,
// which is what "near duplicate" is measured against.
//
// It is derived from the candidate pool's own `Source` field rather than from a
// list in the request: the recipes a user owns are exactly the user-source
// candidates, and asking the caller to send the same fact a second time is how
// two answers to one question start disagreeing.
type ownedCorpus struct {
	sets map[string]map[string]bool
}

func newOwnedCorpus(candidates []Candidate) ownedCorpus {
	sets := map[string]map[string]bool{}
	for _, c := range candidates {
		if c.Source == SourceUser {
			sets[c.RecipeID] = canonicalSet(c)
		}
	}
	return ownedCorpus{sets: sets}
}

// available is REQUEST-level, like every other availability decision here: a
// user who owns no recipes has nothing for a candidate to duplicate, so the
// feature reports unavailable rather than scoring every candidate a flattering
// zero. See affinity.go for why per-candidate availability is a bug.
func (o ownedCorpus) available() bool { return len(o.sets) > 0 }

// similarity is the closest resemblance to anything the user owns, EXCLUDING the
// candidate itself — a recipe is not a near-duplicate of itself.
func (o ownedCorpus) similarity(c Candidate) float64 {
	own := canonicalSet(c)
	var best float64
	for id, set := range o.sets {
		if id == c.RecipeID {
			continue
		}
		if s := jaccard(own, set); s > best {
			best = s
		}
	}
	return best
}

// nearDuplicateValue turns a similarity into a PENALTY in [-1, 0]: nothing at
// all below the gate, ramping to -1 for an exact ingredient copy.
func nearDuplicateValue(similarity float64) float64 {
	if similarity < nearDuplicateThreshold {
		return 0
	}
	return -(similarity - nearDuplicateThreshold) / (1 - nearDuplicateThreshold)
}

// noveltyValue is how new this recipe is to the user, in [0, 1].
//
// Every interaction counts against novelty, including a mere impression: a card
// the user has scrolled past six times is not a discovery, whatever the ranker
// thinks of its ingredients. That is the whole reason `shown` is recorded at all
// — it earns its row here and contributes nothing to affinity, because seeing
// something is not an opinion about it.
func noveltyValue(in RecipeInteraction) float64 {
	seen := in.Shown + in.Accepted + in.Cooked
	if seen <= 0 {
		return 1
	}
	return 1 / float64(1+seen)
}

// RankDiscover scores candidates for the "what should I try" intent.
//
// The ordering of concerns mirrors RankPantry exactly, and that is not
// incidental — hard filters run BEFORE scoring, so no score can surface an
// avoided ingredient, and the two surfaces cannot drift into different
// definitions of "safe".
func RankDiscover(uc UserContext, candidates []Candidate) []Result {
	return rankDiscoverWith(uc, candidates, DefaultDiscoverWeights)
}

func rankDiscoverWith(uc UserContext, candidates []Candidate, w Weights) []Result {
	avoid := toSet(uc.Preferences.AvoidItems)
	exclude := toSet(uc.ExcludeRecipeIDs)
	// Recipes the user already owns a copy of. The handler fills this with the
	// CATALOG rows its clones came from, so "Add to my recipes" makes the catalog
	// original stop being a thing to discover — while the clone itself stays in
	// the pool, because rediscovering a recipe you saved and forgot is exactly
	// what this surface is for.
	saved := toSet(uc.SavedRecipeIDs)

	view := newPantryView(uc.Pantry, uc.Now)
	aff := newAffinityView(uc)
	owned := newOwnedCorpus(candidates)
	// nil (field absent) means the caller sent no interaction history at all, so
	// novelty has nothing to read. An EMPTY map is different and is not a gap: it
	// says this user has interacted with nothing, which makes every candidate
	// genuinely, equally new.
	interactionsKnown := uc.Interactions != nil

	results := make([]Result, 0, len(candidates))
	for _, c := range candidates {
		if exclude[c.RecipeID] || saved[c.RecipeID] || containsAvoided(c, avoid) {
			continue
		}
		in := uc.Interactions[c.RecipeID]
		// A dismissal REMOVES the candidate rather than down-weighting it. The
		// user answered the question this surface asks; re-asking with a slightly
		// worse rank is not respecting the answer. It comes back when the event
		// falls out of the caller's recency window — "not this month", not
		// "never".
		if in.Dismissed > 0 {
			continue
		}

		na := assess(uc.NutritionTargets, c.Nutrition, uc.PlanNutrition)
		if na.violates {
			continue
		}

		m := matchCandidate(c, view)
		d := matchDiscovery(c, uc.Preferences)
		affValue := aff.score(c)
		novelty := noveltyValue(in)
		nearDup := nearDuplicateValue(owned.similarity(c))

		var coverage float64
		if m.total > 0 {
			coverage = float64(len(m.have)) / float64(m.total)
		}

		features := []feature{
			affinityFeature(affValue, aff, w),
			{name: "novelty", value: novelty, weight: w.Novelty, available: interactionsKnown},
			{
				name:      "nearDuplicate",
				value:     nearDup,
				weight:    w.NearDuplicate,
				available: owned.available(),
			},
			// Deliberately SMALL (see DefaultDiscoverWeights): being cookable
			// tonight is a pleasant bonus here, and letting it grow would turn
			// discovery back into the pantry endpoint under a different name.
			{name: "coverage", value: coverage, weight: w.Coverage, available: m.total > 0},
			nutritionFeature(na, w),
		}
		features = append(features, discoveryFeatures(d, w)...)

		// Reason order is a ranking of what matters on THIS surface, and the card
		// shows the first two or three. Taste leads, because taste is the question
		// discovery answers; the pantry line comes last, because "and you could
		// cook it tonight" is a closing argument, not an opening one.
		var reasons []string
		if r := affinityReason(affValue); r != "" {
			reasons = append(reasons, r)
		}
		reasons = append(reasons, discoveryReasons(d)...)
		if r := nutritionReason(na); r != "" {
			reasons = append(reasons, r)
		}
		if r := noveltyReason(interactionsKnown, novelty); r != "" {
			reasons = append(reasons, r)
		}
		if r := pantryBonusReason(m); r != "" {
			reasons = append(reasons, r)
		}

		results = append(results, Result{
			RecipeID: c.RecipeID,
			Title:    c.Title,
			Source:   c.Source,
			Score:    combine(features),
			// Non-nil throughout: a nil Go slice marshals to `null`, and the web
			// client's non-nullable types then throw on the success path. This has
			// crashed the app once already.
			Reasons:             nonNilStrings(reasons),
			Have:                nonNilStrings(m.have),
			Missing:             nonNilMissing(m.missing),
			Urgency:             urgentOrNil(m),
			NutritionFit:        fitOrNil(na),
			NutritionUnverified: nonNilUnverified(na.unverified),
		})
	}

	sort.SliceStable(results, func(i, j int) bool {
		if results[i].Score != results[j].Score {
			return results[i].Score > results[j].Score
		}
		return results[i].RecipeID < results[j].RecipeID
	})

	limit := uc.Limit
	if limit <= 0 {
		limit = defaultLimit
	}
	if limit > maxLimit {
		limit = maxLimit
	}
	if len(results) > limit {
		results = results[:limit]
	}
	return results
}

// noveltyReason claims newness only when the recipe is genuinely untouched.
// Anything the user has already seen once is not news, and a "new to you" line
// on a card they scrolled past yesterday is the kind of small lie that makes a
// whole surface untrustworthy.
func noveltyReason(known bool, novelty float64) string {
	if !known || novelty < 1 {
		return ""
	}
	return "New to you"
}

// pantryBonusReason is the discovery phrasing of the pantry match: an aside
// about convenience, not the pantry surface's claim about what to cook.
// Deliberately silent below two hits — "uses 1 thing you have" is true of almost
// every recipe and says nothing.
func pantryBonusReason(m match) string {
	if len(m.have) < 2 {
		return ""
	}
	if len(m.missing) == 0 {
		return "You already have everything"
	}
	return "Uses things you already have"
}
