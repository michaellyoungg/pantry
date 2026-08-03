package recommend

// feature is one scored dimension.
//
// `available` reports whether the DATA BACKING this feature exists yet. An
// unavailable feature is excluded from both the numerator and the denominator,
// so a feature whose backing backlog item has not shipped cannot drag a score
// toward zero — it simply is not part of the average. This is what lets
// BL-0029 expiry and BL-0023 cost join later as pure additions.
//
// value is expected in [-1, 1]; penalties are expressed as negative values.
type feature struct {
	name      string
	value     float64
	weight    float64
	available bool
}

// combine folds features into a single score in [0, 1], normalizing by the
// weight of the features that actually had data. Returns 0 when none did.
func combine(fs []feature) float64 {
	var num, den float64
	for _, f := range fs {
		if !f.available {
			continue
		}
		num += f.weight * f.value
		den += f.weight
	}
	if den == 0 {
		return 0
	}
	score := num / den
	if score < 0 {
		return 0
	}
	if score > 1 {
		return 1
	}
	return score
}
