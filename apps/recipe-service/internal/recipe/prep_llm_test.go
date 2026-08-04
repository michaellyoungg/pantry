package recipe

import (
	"context"
	"errors"
	"strings"
	"testing"
)

type fakeTagger struct {
	tags  RecipeTags
	err   error
	calls int
}

func (f *fakeTagger) Tag(context.Context, string, []Ingredient, []string) (RecipeTags, error) {
	f.calls++
	return f.tags, f.err
}

// The design constraint of the whole LLM half: the model chooses a rule, and
// the rule supplies the sentence. Nothing the model returns can become prep
// text, so a bad rule stays as explainable and as fixable as any other.
func TestPrepTasksFromSuggestions_TextComesFromTheRuleTable(t *testing.T) {
	got := PrepTasksFromSuggestions(context.Background(), []PrepSuggestion{
		{RuleID: "thaw_frozen_protein", Subject: "Duck Breast"},
	})

	if len(got) != 1 {
		t.Fatalf("got %d tasks, want 1: %+v", len(got), got)
	}
	rule, ok := prepRuleSet.byID("thaw_frozen_protein")
	if !ok {
		t.Fatal("thaw_frozen_protein is gone from the rule table")
	}
	if got[0].Window != rule.Window {
		t.Errorf("window = %q, want the rule's %q", got[0].Window, rule.Window)
	}
	if got[0].Text != "Move the duck breast to the fridge to thaw" {
		t.Errorf("text = %q, want the rule's sentence with the subject interpolated", got[0].Text)
	}
	if got[0].Source != PrepSourceLLM {
		t.Errorf("source = %q, want llm", got[0].Source)
	}
	// Same key shape as derivation, which is what lets a rule that later learns
	// to match this deterministically collapse onto the model's task instead of
	// duplicating it.
	if got[0].Key != "thaw_frozen_protein:duck breast" {
		t.Errorf("key = %q, want ruleID:subject", got[0].Key)
	}
}

func TestPrepTasksFromSuggestions_DropsUnknownRules(t *testing.T) {
	got := PrepTasksFromSuggestions(context.Background(), []PrepSuggestion{
		{RuleID: "invent_a_prep_step", Subject: "the sauce"},
		{RuleID: "preheat_oven", Subject: "bake"},
	})

	if len(got) != 1 || got[0].Key != "preheat_oven:bake" {
		t.Errorf("got %+v, want only the real rule to survive", got)
	}
}

func TestPrepTasksFromSuggestions_CollapsesRepeats(t *testing.T) {
	got := PrepTasksFromSuggestions(context.Background(), []PrepSuggestion{
		{RuleID: "preheat_oven", Subject: "bake"},
		{RuleID: "preheat_oven", Subject: "Bake"},
	})
	if len(got) != 1 {
		t.Errorf("got %d tasks, want the repeat collapsed: %+v", len(got), got)
	}
}

// A deterministic hit is free, explainable and improvable for every recipe at
// once. It always wins, and the model is never asked.
func TestImporter_TaggerIsNotCalledWhenTheScanFoundSomething(t *testing.T) {
	tagger := &fakeTagger{tags: RecipeTags{Methods: []string{"sous_vide"}}}
	imp := NewImporter(fakeFetcher{body: []byte(pageWithEquipmentInSteps)}, nil, WithTagger(tagger))

	rec, err := imp.Import(context.Background(), "u1", "https://example.com/r")
	if err != nil {
		t.Fatalf("import: %v", err)
	}
	if tagger.calls != 0 {
		t.Errorf("tagger called %d times for a recipe the keyword scan already tagged", tagger.calls)
	}
	if len(rec.Methods) == 0 {
		t.Error("the deterministic tags were lost")
	}
}

func TestImporter_TaggerFillsTheGap(t *testing.T) {
	tagger := &fakeTagger{tags: RecipeTags{
		Equipment: []RecipeEquipment{{ID: "oven", Required: true}},
		Methods:   []string{"bake"},
		Prep:      []PrepSuggestion{{RuleID: "preheat_oven", Subject: "bake"}},
	}}
	imp := NewImporter(fakeFetcher{body: []byte(pageWithNoTags)}, nil, WithTagger(tagger))

	rec, err := imp.Import(context.Background(), "u1", "https://example.com/r")
	if err != nil {
		t.Fatalf("import: %v", err)
	}
	if tagger.calls != 1 {
		t.Fatalf("tagger called %d times, want exactly once", tagger.calls)
	}
	if got := equipIDs(rec.Equipment); len(got) != 1 || got[0] != "oven" {
		t.Errorf("equipment = %v, want the model's tag", got)
	}
	if len(rec.Methods) != 1 || rec.Methods[0] != "bake" {
		t.Errorf("methods = %v, want the model's tag", rec.Methods)
	}
	if len(rec.PrepTasks) != 1 || rec.PrepTasks[0].Source != PrepSourceLLM {
		t.Errorf("prep = %+v, want one llm-sourced task", rec.PrepTasks)
	}
}

// Enrichment is optional; the recipe the user asked for is not. A tagging
// failure must cost the tags and nothing else.
func TestImporter_TaggerFailureDoesNotFailTheImport(t *testing.T) {
	tagger := &fakeTagger{err: errors.New("timeout")}
	imp := NewImporter(fakeFetcher{body: []byte(pageWithNoTags)}, nil, WithTagger(tagger))

	rec, err := imp.Import(context.Background(), "u1", "https://example.com/r")
	if err != nil {
		t.Fatalf("import failed because an optional enrichment did: %v", err)
	}
	if rec.Title != "Fruit Salad" || len(rec.Ingredients) == 0 {
		t.Errorf("recipe = %+v, want the import to have succeeded anyway", rec)
	}
	if len(rec.PrepTasks) != 0 {
		t.Errorf("prep = %+v, want none", rec.PrepTasks)
	}
}

// One bad slug should not cost the user the tags the model got right.
func TestImporter_TaggerJunkIsDroppedNotFatal(t *testing.T) {
	tagger := &fakeTagger{tags: RecipeTags{
		Equipment: []RecipeEquipment{{ID: "flux_capacitor", Required: true}, {ID: "oven", Required: true}},
		Methods:   []string{"levitate", "bake"},
	}}
	imp := NewImporter(fakeFetcher{body: []byte(pageWithNoTags)}, nil, WithTagger(tagger))

	rec, err := imp.Import(context.Background(), "u1", "https://example.com/r")
	if err != nil {
		t.Fatalf("import: %v", err)
	}
	if got := equipIDs(rec.Equipment); len(got) != 1 || got[0] != "oven" {
		t.Errorf("equipment = %v, want only the catalog slug kept", got)
	}
	if len(rec.Methods) != 1 || rec.Methods[0] != "bake" {
		t.Errorf("methods = %v, want only the enum member kept", rec.Methods)
	}
}

// Without a key there is no tagger, and the import path must be exactly what it
// was before this item — which is the state the app actually ships in today.
func TestImporter_NoTaggerConfiguredIsTheNormalCase(t *testing.T) {
	imp := NewImporter(fakeFetcher{body: []byte(pageWithNoTags)}, nil)

	rec, err := imp.Import(context.Background(), "u1", "https://example.com/r")
	if err != nil {
		t.Fatalf("import: %v", err)
	}
	if len(rec.Equipment) != 0 || len(rec.Methods) != 0 || len(rec.PrepTasks) != 0 {
		t.Errorf("recipe = %+v, want no tags and no prep", rec)
	}
	// Never null on the wire: a null here is a crash in every client that maps
	// over it.
	if rec.PrepTasks == nil {
		t.Error("prepTasks is nil and will marshal as null")
	}
}

// The prompt is built from the shipped data, so a new rule or a new piece of
// equipment reaches the model with no second edit. If that ever stops being
// true the model starts choosing from a stale menu and nothing else notices.
func TestTagUserPrompt_OffersTheShippedVocabularies(t *testing.T) {
	prompt := tagUserPrompt("Fruit Salad", []Ingredient{{Item: "apples"}}, []string{"Chop the fruit."})

	for _, want := range []string{"Fruit Salad", "apples", "Chop the fruit."} {
		if !strings.Contains(prompt, want) {
			t.Errorf("prompt is missing the recipe itself: %q", want)
		}
	}
	for _, rule := range PrepRuleCatalog() {
		if !strings.Contains(prompt, rule.ID) {
			t.Errorf("prompt does not offer rule %q", rule.ID)
		}
	}
	for _, e := range EquipmentList() {
		if !strings.Contains(prompt, e.ID) {
			t.Errorf("prompt does not offer equipment %q", e.ID)
		}
	}
	for _, m := range equipmentCatalog.Methods() {
		if !strings.Contains(prompt, m.ID) {
			t.Errorf("prompt does not offer method %q", m.ID)
		}
	}
}

// The schema is the enforcement, not the prose: there must be nowhere for the
// model to put a sentence it wrote itself.
func TestTagJSONSchema_HasNowhereToWritePrepText(t *testing.T) {
	schema := tagJSONSchema()
	props, _ := schema["properties"].(map[string]any)
	prep, _ := props["prep"].(map[string]any)
	items, _ := prep["items"].(map[string]any)
	fields, _ := items["properties"].(map[string]any)

	if _, bad := fields["text"]; bad {
		t.Error("the prep schema has a text field; the model can write its own prep advice")
	}
	if items["additionalProperties"] != false {
		t.Error("the prep schema allows extra properties")
	}
	if _, ok := fields["ruleId"]; !ok {
		t.Error("the prep schema does not ask for a rule id")
	}
}
