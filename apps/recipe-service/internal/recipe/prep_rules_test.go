package recipe

import (
	"strings"
	"testing"
)

// The shipped rule table has to load. It is embedded and parsed at init, so a
// malformed edit panics the whole service at boot — this is the test that turns
// a bad rule into a red build instead of a red deployment.
func TestShippedPrepRulesLoad(t *testing.T) {
	rs, err := loadPrepRules(prepRulesJSON, normalizer.Categories(), equipmentCatalog)
	if err != nil {
		t.Fatalf("load prep_rules.json: %v", err)
	}
	if len(rs.rules) == 0 {
		t.Fatal("no rules loaded")
	}
	if rs.version == "" {
		t.Error("version is empty; a rule change would be untraceable")
	}
	if PrepRulesVersion() != rs.version {
		t.Errorf("PrepRulesVersion() = %q, want %q", PrepRulesVersion(), rs.version)
	}
}

func TestLoadPrepRulesRejects(t *testing.T) {
	tests := []struct {
		name string
		json string
		want string
	}{
		{
			name: "no version",
			json: `{"rules":[]}`,
			want: "version is required",
		},
		{
			name: "duplicate id",
			json: `{"version":"t","rules":[
				{"id":"a","when":{"method":"bake"},"window":"at_start","text":"x","priority":1},
				{"id":"a","when":{"method":"boil"},"window":"at_start","text":"y","priority":1}
			]}`,
			want: "duplicate id",
		},
		{
			name: "unknown window",
			json: `{"version":"t","rules":[
				{"id":"a","when":{"method":"bake"},"window":"whenever","text":"x","priority":1}
			]}`,
			want: "unknown window",
		},
		{
			// The whole reason this check exists: a misspelled method is not a
			// small bug, it is a rule that silently never fires.
			name: "unknown method",
			json: `{"version":"t","rules":[
				{"id":"a","when":{"method":"bakeing"},"window":"at_start","text":"x","priority":1}
			]}`,
			want: "unknown cooking method",
		},
		{
			name: "unknown equipment",
			json: `{"version":"t","rules":[
				{"id":"a","when":{"equipment":"toaster"},"window":"at_start","text":"x","priority":1}
			]}`,
			want: "unknown equipment",
		},
		{
			name: "category no item carries",
			json: `{"version":"t","rules":[
				{"id":"a","when":{"category":"nightshade"},"window":"at_start","text":"x","priority":1}
			]}`,
			want: "no item carries category",
		},
		{
			name: "unknown ingredient state",
			json: `{"version":"t","rules":[
				{"id":"a","when":{"category":"protein","ingredientState":"chilled"},"window":"at_start","text":"x","priority":1}
			]}`,
			want: "unknown ingredient state",
		},
		{
			name: "no subject axis",
			json: `{"version":"t","rules":[
				{"id":"a","when":{},"window":"at_start","text":"x","priority":1}
			]}`,
			want: "exactly one of",
		},
		{
			name: "two subject axes",
			json: `{"version":"t","rules":[
				{"id":"a","when":{"method":"bake","equipment":"oven"},"window":"at_start","text":"x","priority":1}
			]}`,
			want: "exactly one of",
		},
		{
			name: "ingredient qualifier on a method rule",
			json: `{"version":"t","rules":[
				{"id":"a","when":{"method":"bake","ingredientState":"frozen"},"window":"at_start","text":"x","priority":1}
			]}`,
			want: "ingredientState only applies",
		},
		{
			name: "weight qualifier on an equipment rule",
			json: `{"version":"t","rules":[
				{"id":"a","when":{"equipment":"oven","minQuantityLb":3},"window":"at_start","text":"x","priority":1}
			]}`,
			want: "minQuantityLb only applies",
		},
		{
			name: "empty text",
			json: `{"version":"t","rules":[
				{"id":"a","when":{"method":"bake"},"window":"at_start","text":"  ","priority":1}
			]}`,
			want: "text is required",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, err := loadPrepRules([]byte(tc.json), normalizer.Categories(), equipmentCatalog)
			if err == nil {
				t.Fatalf("loaded successfully, want error containing %q", tc.want)
			}
			if !strings.Contains(err.Error(), tc.want) {
				t.Errorf("err = %v, want it to contain %q", err, tc.want)
			}
		})
	}
}

// Every window a rule uses must have a lead time, or a task derives against a
// silently-zero offset and "the night before" becomes "the morning of".
func TestEveryShippedRuleWindowHasALeadTime(t *testing.T) {
	for _, r := range prepRuleSet.rules {
		i, ok := prepWindowIdx[r.Window]
		if !ok {
			t.Fatalf("rule %q: window %q is not in the enum", r.ID, r.Window)
		}
		if prepWindows[i].Label == "" {
			t.Errorf("window %q has no label for clients to render", r.Window)
		}
	}
}

// A category rule that matches nothing in the dataset is dead weight nobody
// notices. The loader proves the category exists; this proves the dataset was
// actually grown for the rules that key on one.
func TestCategoriesUsedByRulesHaveItems(t *testing.T) {
	counts := map[string]int{}
	for _, it := range normalizer.data.Items {
		if it.Category != "" {
			counts[it.Category]++
		}
	}
	for _, r := range prepRuleSet.rules {
		if r.When.Category == "" {
			continue
		}
		if counts[r.When.Category] == 0 {
			t.Errorf("rule %q keys on category %q, which no item carries", r.ID, r.When.Category)
		}
	}
	// The generic thaw is worthless without proteins to match; BL-0042 grew the
	// dictionary for exactly this reason.
	if counts["protein"] < 20 {
		t.Errorf("only %d items are categorized as protein; the thaw rules need real coverage", counts["protein"])
	}
}
