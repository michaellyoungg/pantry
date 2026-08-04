package recipe

import (
	"context"
	"log/slog"
	"strings"
)

// The model-derived half of BL-0044.
//
// # What the model is allowed to do
//
// It tags. It does not write prep advice. Given a recipe the deterministic
// keyword scan could not tag, it answers two questions:
//
//  1. Which catalog equipment and which closed-enum methods does this recipe
//     use? (the BL-0041 fallback)
//  2. Which of the *existing* prep rules apply, and to what subject?
//
// The text of a prep task always comes from prep_rules.json, never from the
// model. That is the design constraint the umbrella spec settles on and it is
// enforced here rather than merely requested in a prompt: a suggestion naming a
// rule id that does not exist is dropped, and the surviving ones are rendered
// from the rule table exactly as DerivePrepTasks renders them.
//
// The consequence is that a model-derived task is as explainable as a
// rule-derived one — same wording, same window, same key — and improving a
// rule's text improves it too. What the model contributed is the *match*, which
// is the part the deterministic scan could not do, and `source = llm` records
// that so the UI can say where it came from.

// PrepSuggestion is one thing the model claims about a recipe: this rule
// applies, to this subject. Both halves are validated before use.
type PrepSuggestion struct {
	// RuleID must name a rule in the shipped table. Anything else is dropped.
	RuleID string `json:"ruleId"`
	// Subject is what {item} interpolates to and the second half of the task
	// key — a canonical ingredient for ingredient rules, the method or
	// equipment slug otherwise. Empty is allowed for rules whose text has no
	// {item}.
	Subject string `json:"subject"`
}

// RecipeTags is everything the model may assert about a recipe.
type RecipeTags struct {
	Equipment []RecipeEquipment `json:"equipment"`
	Methods   []string          `json:"methods"`
	Prep      []PrepSuggestion  `json:"prep"`
}

// Tagger fills in equipment, methods and prep matches for a recipe the
// deterministic scan could not tag. Implementations are expected to be network
// calls and may fail; every caller treats failure as "no tags", never as an
// import error.
type Tagger interface {
	Tag(ctx context.Context, title string, ingredients []Ingredient, steps []string) (RecipeTags, error)
}

// PrepTasksFromSuggestions turns validated suggestions into storable tasks.
//
// Every returned task's text and window come from the rule table. Suggestions
// naming an unknown rule are dropped — silently for the caller, loudly in the
// log, because a model that keeps inventing rule ids is a prompt bug worth
// seeing and not worth failing an import over.
func PrepTasksFromSuggestions(ctx context.Context, suggestions []PrepSuggestion) []StoredPrepTask {
	out := make([]StoredPrepTask, 0, len(suggestions))
	seen := map[string]bool{}
	dropped := make([]string, 0)
	for _, s := range suggestions {
		rule, ok := prepRuleSet.byID(s.RuleID)
		if !ok {
			dropped = append(dropped, s.RuleID)
			continue
		}
		subject := strings.ToLower(strings.TrimSpace(s.Subject))
		key := rule.ID + ":" + subject
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, StoredPrepTask{
			Key:    key,
			Window: rule.Window,
			// The rule's own words. The model chose the rule; it did not write
			// this sentence, and it cannot.
			Text:   strings.ReplaceAll(rule.Text, "{item}", subject),
			Source: PrepSourceLLM,
		})
	}
	if len(dropped) > 0 {
		slog.WarnContext(ctx, "prep tagging: dropped suggestions naming unknown rules",
			"count", len(dropped), "ruleIds", dropped)
	}
	return out
}

// byID looks a rule up by its id.
func (rs *PrepRuleSet) byID(id string) (PrepRule, bool) {
	for _, r := range rs.rules {
		if r.ID == id {
			return r, true
		}
	}
	return PrepRule{}, false
}

// PrepRuleCatalog describes the rule table to the model: the id it may choose
// and the sentence that id will produce. It exists so the prompt can be built
// from the shipped data rather than a second, drifting copy of it.
func PrepRuleCatalog() []PrepRule {
	out := make([]PrepRule, len(prepRuleSet.rules))
	copy(out, prepRuleSet.rules)
	return out
}

// applyTags folds a tagger's answer into a recipe, keeping only what validates.
//
// Unknown equipment slugs and methods are dropped rather than rejected: this is
// a best-effort enrichment of an import that already succeeded, and a model
// naming one piece of hardware that is not in the catalog should not cost the
// user the three it got right.
func applyTags(ctx context.Context, rec *Recipe, tags RecipeTags) {
	equip := make([]RecipeEquipment, 0, len(tags.Equipment))
	for _, e := range tags.Equipment {
		if equipmentCatalog.HasEquipment(e.ID) {
			equip = append(equip, e)
		}
	}
	methods := make([]string, 0, len(tags.Methods))
	for _, m := range tags.Methods {
		if equipmentCatalog.HasMethod(m) {
			methods = append(methods, m)
		}
	}
	if len(equip) != len(tags.Equipment) || len(methods) != len(tags.Methods) {
		slog.WarnContext(ctx, "prep tagging: dropped unknown equipment or methods",
			"equipmentKept", len(equip), "equipmentSeen", len(tags.Equipment),
			"methodsKept", len(methods), "methodsSeen", len(tags.Methods))
	}
	rec.Equipment = normEquipment(equip)
	rec.Methods = normMethods(methods)
	rec.PrepTasks = normPrepTasks(PrepTasksFromSuggestions(ctx, tags.Prep))
}
