package recommend

// --- Ingredient affinity (BL-0005 increment 2) ---------------------------
//
// `affinity` was wired and permanently unavailable in increment 1: it needs an
// interaction log, and there was none. There is one now, and this file is the
// whole of what the ranker knows about it — which is deliberately very little.
//
// The RANKER NEVER SEES AN EVENT. Convex owns `recommendationEvents`, folds a
// recent window of them into an ingredient→weight map, and sends that map in the
// request. This package stays dependency-free and stateless, and the derivation
// stays in the one place that owns the history it derives from. Nothing is
// persisted as a score, so there is no derived table to drift from the events
// that produced it.
//
// Two rules here are load-bearing:
//
//   - **A cold-start user makes affinity UNAVAILABLE, never zero.** A user with
//     no history and no stated likes has told us nothing about their taste.
//     Scoring that as 0 would put every candidate at the bottom of a feature
//     that carries real weight, punishing precisely the users who have not used
//     the product yet. `available: false` removes it from both sides of
//     combine()'s average instead, which leaves the remaining features scoring
//     exactly as they did before this file existed.
//   - **Availability is REQUEST-LEVEL, not per candidate.** Deciding it per
//     candidate would normalize two rows of one response by different weight
//     denominators, making their scores incomparable — the exact failure
//     combine() exists to prevent (see pantryView.hasExpiry, which learned this
//     first). So a candidate containing nothing we have an opinion about scores
//     0, which is a real observation ("nothing here is something you've reacted
//     to"), not a missing one.

// affinitySaturation is how many opinionated ingredients a recipe needs before
// it can reach a full ±1 on this feature.
//
// Without it a recipe whose single matched ingredient is garlic would score the
// same as one built entirely out of things the user loves, because a bare mean
// over matched items is blind to how much agreement it is averaging. Dividing by
// at least this many says what we mean: more of the recipe pointing the same way
// is a stronger signal than one line pointing very hard.
const affinitySaturation = 3

// explicitWeight is what a stated like or dislike is worth on the same scale the
// derived weights live on. It is the maximum: the user telling us directly is
// the strongest evidence about their taste that exists.
const explicitWeight = 1.0

// affinityView is the request's ingredient opinions, built once per request
// rather than per candidate.
type affinityView struct {
	// scores maps canonicalItem → [-1, 1]. Absent means no opinion, which is
	// distinct from an opinion of zero and is why this is a map rather than a
	// function returning 0.
	scores map[string]float64
	// available is the cold-start switch, and it is request-level. See the
	// header: per-candidate availability would make rows incomparable.
	available bool
}

// newAffinityView merges the two sources of ingredient opinion the ranker has.
//
// The DERIVED map arrives from Convex's fold over the event log. The EXPLICIT
// lists arrive from the user's own settings, and they OVERRIDE the derived value
// outright rather than averaging with it. Averaging would let a month of
// inferred behaviour argue with something the user typed on purpose, and between
// "we noticed" and "they said", they said wins. (Explicit likes are also why a
// brand-new user who filled in the settings form gets a live affinity feature
// without having interacted with a single recommendation.)
func newAffinityView(uc UserContext) affinityView {
	scores := make(map[string]float64, len(uc.Affinities)+
		len(uc.Preferences.LikedItems)+len(uc.Preferences.DislikedItems))

	for item, weight := range uc.Affinities {
		if item == "" {
			continue
		}
		scores[item] = clampSigned(weight)
	}
	// Dislikes are applied after likes so that an item on both lists resolves to
	// the more cautious answer, the same way the avoid list resolves ties by
	// removing rather than by keeping.
	for _, item := range uc.Preferences.LikedItems {
		if item != "" {
			scores[item] = explicitWeight
		}
	}
	for _, item := range uc.Preferences.DislikedItems {
		if item != "" {
			scores[item] = -explicitWeight
		}
	}

	return affinityView{scores: scores, available: len(scores) > 0}
}

// score reports how much this candidate looks like things the user likes, in
// [-1, 1]. Only ingredients we have an OPINION about contribute; the rest are
// neither evidence for nor against.
//
// De-duplicated by canonical item for the same reason matchCandidate is: a
// recipe listing garlic in two units is not twice as garlicky.
func (v affinityView) score(c Candidate) float64 {
	if !v.available {
		return 0
	}
	var sum float64
	var matched int
	seen := make(map[string]bool, len(c.Ingredients))
	for _, ing := range c.Ingredients {
		if seen[ing.CanonicalItem] {
			continue
		}
		seen[ing.CanonicalItem] = true
		w, ok := v.scores[ing.CanonicalItem]
		if !ok {
			continue
		}
		sum += w
		matched++
	}
	if matched == 0 {
		return 0
	}
	denom := matched
	if denom < affinitySaturation {
		denom = affinitySaturation
	}
	return clampSigned(sum / float64(denom))
}

// affinityFeature is shared by BOTH surfaces. Discovery weights it heavily and
// the pantry surface lightly, but the value and its availability are computed
// identically — two definitions of "you like this" would eventually disagree,
// and the user would have no way to tell which screen was lying.
func affinityFeature(value float64, v affinityView, w Weights) feature {
	return feature{
		name:      "affinity",
		value:     value,
		weight:    w.Affinity,
		available: v.available,
	}
}

// affinityReasonThreshold is how strong the signal has to be before the card
// claims it out loud. A faint positive still ranks; it just does not boast.
const affinityReasonThreshold = 0.34

// affinityReason explains the feature, and only ever in the positive direction.
// "Built on things you don't like" is a true statement we have no business
// putting on screen — the recipe is already ranked below the alternatives, which
// is the entire action a negative signal justifies.
func affinityReason(value float64) string {
	if value < affinityReasonThreshold {
		return ""
	}
	return "Uses things you cook a lot"
}

func clampSigned(x float64) float64 {
	if x < -1 {
		return -1
	}
	if x > 1 {
		return 1
	}
	return x
}
