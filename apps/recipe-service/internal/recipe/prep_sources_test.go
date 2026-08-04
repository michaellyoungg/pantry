package recipe

import (
	"errors"
	"testing"
	"time"
)

func mergeCookDate(t *testing.T) time.Time {
	t.Helper()
	d, err := time.Parse(isoDate, "2026-08-10")
	if err != nil {
		t.Fatalf("parse cook date: %v", err)
	}
	return d
}

func taskByKey(tasks []PrepTask, key string) (PrepTask, bool) {
	for _, t := range tasks {
		if t.Key == key {
			return t, true
		}
	}
	return PrepTask{}, false
}

// The three-way case is the one the whole item exists for: when all three
// producers claim the same key, exactly one task survives and it is the one the
// user wrote.
func TestMergePrepTasks_PrecedenceManualOverLLMOverRule(t *testing.T) {
	cookDate := mergeCookDate(t)
	const key = "thaw_frozen_protein:chicken breast"

	derived := []PrepTask{{
		Key:     key,
		RuleID:  "thaw_frozen_protein",
		Subject: "chicken breast",
		Window:  WindowNightBefore,
		Text:    "Move the chicken breast to the fridge to thaw",
		Source:  PrepSourceRule,
		DueOn:   "2026-08-09",
	}}
	stored := []StoredPrepTask{
		{Key: key, Window: WindowNightBefore, Text: "Thaw it overnight", Source: PrepSourceLLM},
		{Key: key, Window: WindowTwoDaysBefore, Text: "Take the chicken out Saturday — our fridge is cold", Source: PrepSourceManual},
	}

	got := MergePrepTasks(derived, stored, cookDate)

	if len(got) != 1 {
		t.Fatalf("merged %d tasks, want 1 — the key is shared, so they must collapse: %+v", len(got), got)
	}
	if got[0].Source != PrepSourceManual {
		t.Errorf("source = %q, want %q", got[0].Source, PrepSourceManual)
	}
	if got[0].Text != "Take the chicken out Saturday — our fridge is cold" {
		t.Errorf("text = %q, want the hand-authored one", got[0].Text)
	}
	// The manual task carries its own window, so it carries its own lead time.
	if got[0].Window != WindowTwoDaysBefore || got[0].DueOn != "2026-08-08" {
		t.Errorf("window/dueOn = %q/%q, want two_days_before/2026-08-08", got[0].Window, got[0].DueOn)
	}
}

func TestMergePrepTasks_LLMWinsWhenNoManualTask(t *testing.T) {
	const key = "preheat_oven:bake"
	derived := []PrepTask{{Key: key, Window: WindowAtStart, Text: "Preheat the oven", Source: PrepSourceRule}}
	stored := []StoredPrepTask{{Key: key, Window: WindowHourBefore, Text: "Preheat to 500F — pizza", Source: PrepSourceLLM}}

	got := MergePrepTasks(derived, stored, mergeCookDate(t))

	if len(got) != 1 || got[0].Source != PrepSourceLLM {
		t.Fatalf("got %+v, want the single llm task", got)
	}
}

// A stored task nobody else claims is added, not swallowed: overriding is the
// point of the key, but authoring something new is the common case.
func TestMergePrepTasks_UnclaimedStoredTaskIsAdded(t *testing.T) {
	derived := []PrepTask{{
		Key: "preheat_oven:bake", Window: WindowAtStart, Text: "Preheat the oven",
		Source: PrepSourceRule, DueOn: "2026-08-10",
	}}
	stored := []StoredPrepTask{{
		Key: "manual:make-the-pastry", Window: WindowNightBefore,
		Text: "Make the pastry and chill it", Source: PrepSourceManual,
	}}

	got := MergePrepTasks(derived, stored, mergeCookDate(t))

	if len(got) != 2 {
		t.Fatalf("merged %d tasks, want 2: %+v", len(got), got)
	}
	// Coarsest window first, exactly as derivation orders its own output.
	if got[0].Key != "manual:make-the-pastry" || got[1].Key != "preheat_oven:bake" {
		t.Errorf("order = %q, %q; want the night-before task ahead of the at-start one", got[0].Key, got[1].Key)
	}
	if got[0].DueOn != "2026-08-09" {
		t.Errorf("dueOn = %q, want the cook date minus one night", got[0].DueOn)
	}
	// The key's halves are reported so a client can group without parsing keys.
	if got[0].RuleID != "manual" || got[0].Subject != "make-the-pastry" {
		t.Errorf("ruleId/subject = %q/%q, want the two halves of the key", got[0].RuleID, got[0].Subject)
	}
}

func TestMergePrepTasks_EmptyStoredLeavesDerivedUntouched(t *testing.T) {
	derived := []PrepTask{{Key: "a:b", Window: WindowAtStart, Text: "Preheat the oven", Source: PrepSourceRule}}
	got := MergePrepTasks(derived, nil, mergeCookDate(t))
	if len(got) != 1 || got[0].Text != "Preheat the oven" {
		t.Fatalf("got %+v, want the derived task unchanged", got)
	}
}

// Merging runs against real derivation, not a hand-built list: it is the whole
// path the endpoint takes, and the keys have to line up for real.
func TestMergePrepTasks_OverridesARealDerivedTask(t *testing.T) {
	cookDate := mergeCookDate(t)
	rec := Recipe{
		Title:       "Roast chicken",
		Ingredients: []Ingredient{{Quantity: 2, Unit: "lb", Item: "frozen chicken breast"}},
		Methods:     []string{"roast"},
	}
	derived := DerivePrepTasks(rec, cookDate)
	if len(derived) == 0 {
		t.Fatal("no rule fired for a frozen chicken breast — the fixture no longer exercises the merge")
	}
	target := derived[0]

	stored, err := NormalizePrepTasks([]StoredPrepTask{
		{Key: target.Key, Window: WindowThreeDaysBefore, Text: "Out of the freezer Friday"},
	}, PrepSourceManual)
	if err != nil {
		t.Fatalf("normalize: %v", err)
	}

	got := MergePrepTasks(derived, stored, cookDate)

	if len(got) != len(derived) {
		t.Errorf("merged to %d tasks from %d derived — an override must replace, not add", len(got), len(derived))
	}
	merged, ok := taskByKey(got, target.Key)
	if !ok {
		t.Fatalf("key %q disappeared from the merge", target.Key)
	}
	if merged.Source != PrepSourceManual || merged.Text != "Out of the freezer Friday" {
		t.Errorf("task = %+v, want the hand-authored override", merged)
	}
}

func TestNormalizePrepTasks_AssignsKeysAndTrims(t *testing.T) {
	got, err := NormalizePrepTasks([]StoredPrepTask{
		{Window: WindowNightBefore, Text: "  Take the turkey   out  "},
	}, PrepSourceManual)
	if err != nil {
		t.Fatalf("normalize: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("got %d tasks, want 1", len(got))
	}
	if got[0].Text != "Take the turkey out" {
		t.Errorf("text = %q, want whitespace collapsed", got[0].Text)
	}
	if got[0].Key != "manual:take-the-turkey-out" {
		t.Errorf("key = %q, want a slug of the text", got[0].Key)
	}
	if got[0].Source != PrepSourceManual {
		t.Errorf("source = %q, want it stamped by the caller", got[0].Source)
	}
}

// Saving the same form twice must not produce two rows saying the same thing.
func TestNormalizePrepTasks_IsIdempotentOnText(t *testing.T) {
	in := []StoredPrepTask{
		{Window: WindowNightBefore, Text: "Take the turkey out"},
		{Window: WindowAtStart, Text: "Take the turkey out"},
	}
	got, err := NormalizePrepTasks(in, PrepSourceManual)
	if err != nil {
		t.Fatalf("normalize: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("got %d tasks, want the duplicate collapsed: %+v", len(got), got)
	}
}

func TestNormalizePrepTasks_KeepsAnExplicitOverrideKey(t *testing.T) {
	got, err := NormalizePrepTasks([]StoredPrepTask{
		{Key: "thaw_frozen_protein:turkey", Window: WindowThreeDaysBefore, Text: "Out of the freezer Friday"},
	}, PrepSourceManual)
	if err != nil {
		t.Fatalf("normalize: %v", err)
	}
	if got[0].Key != "thaw_frozen_protein:turkey" {
		t.Errorf("key = %q, want the rule key the author is overriding", got[0].Key)
	}
}

func TestNormalizePrepTasks_DropsEmptyRows(t *testing.T) {
	got, err := NormalizePrepTasks([]StoredPrepTask{
		{Window: WindowNightBefore, Text: "   "},
		{Window: WindowNightBefore, Text: "Real one"},
	}, PrepSourceManual)
	if err != nil {
		t.Fatalf("normalize: %v", err)
	}
	if len(got) != 1 || got[0].Text != "Real one" {
		t.Errorf("got %+v, want the blank row dropped and the save allowed", got)
	}
}

func TestNormalizePrepTasks_Rejects(t *testing.T) {
	long := make([]byte, maxPrepTaskTextLen+1)
	for i := range long {
		long[i] = 'a'
	}
	many := make([]StoredPrepTask, maxPrepTasksPerRecipe+1)
	for i := range many {
		many[i] = StoredPrepTask{Window: WindowAtStart, Text: string(rune('a'+i%26)) + "task"}
	}

	cases := map[string][]StoredPrepTask{
		"unknown window":     {{Window: "whenever", Text: "Do the thing"}},
		"empty window":       {{Text: "Do the thing"}},
		"text too long":      {{Window: WindowAtStart, Text: string(long)}},
		"too many tasks":     many,
		"foreign source":     {{Window: WindowAtStart, Text: "Do the thing", Source: PrepSourceLLM}},
		"rule source":        {{Window: WindowAtStart, Text: "Do the thing", Source: PrepSourceRule}},
		"unknown source tag": {{Window: WindowAtStart, Text: "Do the thing", Source: "vibes"}},
	}
	for name, in := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := NormalizePrepTasks(in, PrepSourceManual); !errors.Is(err, ErrPrepTaskInvalid) {
				t.Errorf("err = %v, want ErrPrepTaskInvalid", err)
			}
		})
	}
}

// Provenance must be a fact about who wrote the row. A client that could stamp
// its own source could label its guess "manual" and the UI would tell the user
// they wrote something they never wrote.
func TestNormalizePrepTasks_StampsTheCallersSource(t *testing.T) {
	got, err := NormalizePrepTasks([]StoredPrepTask{
		{Window: WindowNightBefore, Text: "Thaw the fish"},
	}, PrepSourceLLM)
	if err != nil {
		t.Fatalf("normalize: %v", err)
	}
	if got[0].Source != PrepSourceLLM || got[0].Key != "llm:thaw-the-fish" {
		t.Errorf("got %+v, want an llm-stamped task with an llm-namespaced key", got[0])
	}
}

func TestPrepKeySlug(t *testing.T) {
	cases := map[string]string{
		"Take the turkey out":      "take-the-turkey-out",
		"  Preheat: the oven!  ":   "preheat-the-oven",
		"???":                      "task",
		"Soak the beans — 8 hours": "soak-the-beans-8-hours",
	}
	for in, want := range cases {
		if got := prepKeySlug(in); got != want {
			t.Errorf("prepKeySlug(%q) = %q, want %q", in, got, want)
		}
	}
}
