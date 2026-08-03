package recipe

import (
	"strings"
	"testing"
	"time"
)

// cookDay is the fixed cook date every case below derives against. A literal
// date rather than time.Now(): the entire point of the engine is that its
// output depends on the cook date and nothing else.
var cookDay = time.Date(2026, 8, 5, 0, 0, 0, 0, time.UTC) // Wednesday

func ing(qty float64, unit, item, note string) Ingredient {
	return Ingredient{Quantity: qty, Unit: unit, Item: item, Note: note}
}

// taskKeys is the compact assertion shape: a task is identified by its stable
// key, and its window and due date are what the feature is actually about.
func taskKeys(tasks []PrepTask) []string {
	out := make([]string, 0, len(tasks))
	for _, t := range tasks {
		out = append(out, t.Key)
	}
	return out
}

func TestDerivePrepTasks(t *testing.T) {
	tests := []struct {
		name     string
		recipe   Recipe
		wantKeys []string
	}{
		{
			name:     "no ingredients, methods or equipment yields nothing",
			recipe:   Recipe{Title: "Cereal"},
			wantKeys: []string{},
		},
		{
			name: "a frozen protein thaws the night before",
			recipe: Recipe{Ingredients: []Ingredient{
				ing(2, "lb", "frozen chicken breast", ""),
			}},
			wantKeys: []string{"thaw_frozen_protein:chicken breast"},
		},
		{
			name: "the state may live in the note instead of the item",
			recipe: Recipe{Ingredients: []Ingredient{
				ing(2, "lb", "chicken thighs", "frozen"),
			}},
			wantKeys: []string{"thaw_frozen_protein:chicken thigh"},
		},
		{
			name: "\"thawed\" is the same signal as \"frozen\" — something must leave the freezer",
			recipe: Recipe{Ingredients: []Ingredient{
				ing(1, "lb", "salmon", "thawed"),
			}},
			wantKeys: []string{"thaw_frozen_protein:salmon"},
		},
		{
			name: "a protein with no state word produces nothing",
			recipe: Recipe{Ingredients: []Ingredient{
				ing(2, "lb", "chicken breast", "diced"),
			}},
			wantKeys: []string{},
		},
		{
			name: "an unclassified ingredient never matches a category rule",
			recipe: Recipe{Ingredients: []Ingredient{
				ing(1, "lb", "frozen unicorn steaks", ""),
			}},
			wantKeys: []string{},
		},
		{
			name: "a large frozen roast supersedes the generic thaw rather than doubling it",
			recipe: Recipe{Ingredients: []Ingredient{
				ing(14, "lb", "frozen turkey", ""),
			}},
			wantKeys: []string{"thaw_frozen_large_roast:turkey"},
		},
		{
			name: "below the weight threshold the generic thaw still applies",
			recipe: Recipe{Ingredients: []Ingredient{
				ing(4, "lb", "frozen turkey", ""),
			}},
			wantKeys: []string{"thaw_frozen_protein:turkey"},
		},
		{
			name: "a quantity with no mass unit cannot clear a weight threshold",
			recipe: Recipe{Ingredients: []Ingredient{
				ing(12, "", "frozen turkey", ""),
			}},
			wantKeys: []string{"thaw_frozen_protein:turkey"},
		},
		{
			name: "ounces convert to pounds before the threshold is applied",
			recipe: Recipe{Ingredients: []Ingredient{
				ing(160, "oz", "frozen brisket", ""), // 10 lb
			}},
			wantKeys: []string{"thaw_frozen_large_roast:brisket"},
		},
		{
			name: "two lines that canonicalize to one item produce one task",
			recipe: Recipe{Ingredients: []Ingredient{
				ing(1, "lb", "frozen chicken breasts", ""),
				ing(1, "lb", "boneless skinless chicken breast", "frozen"),
			}},
			wantKeys: []string{"thaw_frozen_protein:chicken breast"},
		},
		{
			name: "distinct frozen proteins each get their own task",
			recipe: Recipe{Ingredients: []Ingredient{
				ing(1, "lb", "frozen shrimp", ""),
				ing(1, "lb", "frozen cod", ""),
			}},
			wantKeys: []string{"thaw_frozen_protein:cod", "thaw_frozen_protein:shrimp"},
		},
		{
			name: "softened butter beats the generic temper rule for the same subject",
			recipe: Recipe{Ingredients: []Ingredient{
				ing(1, "cup", "unsalted butter", "softened, at room temperature"),
			}},
			wantKeys: []string{"soften_butter:butter"},
		},
		{
			name: "a dairy item at room temperature tempers",
			recipe: Recipe{Ingredients: []Ingredient{
				ing(2, "", "eggs", "room temperature"),
			}},
			wantKeys: []string{"temper_dairy:egg"},
		},
		{
			name: "dried legumes soak overnight",
			recipe: Recipe{Ingredients: []Ingredient{
				ing(1, "cup", "dried black beans", ""),
			}},
			wantKeys: []string{"soak_dried_legume:black bean"},
		},
		{
			name: "canned legumes do not — the rule needs the state word",
			recipe: Recipe{Ingredients: []Ingredient{
				ing(1, "cup", "black beans", "rinsed"),
			}},
			wantKeys: []string{},
		},
		{
			name: "a frozen pantry item thaws too",
			recipe: Recipe{Ingredients: []Ingredient{
				ing(10, "oz", "frozen spinach", "thawed and squeezed dry"),
			}},
			wantKeys: []string{"thaw_frozen_ingredient:frozen spinach"},
		},
		{
			name:     "a method rule fires off the recipe's method tags",
			recipe:   Recipe{Methods: []string{"slow_cook"}},
			wantKeys: []string{"start_slow_cooker:slow_cook"},
		},
		{
			name:     "an equipment rule fires off the recipe's equipment tags",
			recipe:   Recipe{Equipment: []RecipeEquipment{{ID: "smoker", Required: true}}},
			wantKeys: []string{"light_smoker:smoker"},
		},
		{
			name:     "optional equipment still counts — the cook may still light it",
			recipe:   Recipe{Equipment: []RecipeEquipment{{ID: "grill", Required: false}}},
			wantKeys: []string{"light_grill:grill"},
		},
		{
			name: "two rules reaching identical advice say it once",
			recipe: Recipe{
				Methods:   []string{"bake", "roast"},
				Equipment: []RecipeEquipment{{ID: "oven", Required: true}},
			},
			wantKeys: []string{"preheat_oven:oven"},
		},
		{
			name: "a whole smoked brisket: the long thaw leads, the smoker follows",
			recipe: Recipe{
				Ingredients: []Ingredient{ing(12, "lb", "frozen brisket", "")},
				Methods:     []string{"smoke"},
				Equipment:   []RecipeEquipment{{ID: "smoker", Required: true}},
			},
			wantKeys: []string{"thaw_frozen_large_roast:brisket", "light_smoker:smoker"},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := taskKeys(DerivePrepTasks(tc.recipe, cookDay))
			if len(got) != len(tc.wantKeys) {
				t.Fatalf("keys = %v, want %v", got, tc.wantKeys)
			}
			for i := range got {
				if got[i] != tc.wantKeys[i] {
					t.Fatalf("keys = %v, want %v", got, tc.wantKeys)
				}
			}
		})
	}
}

func TestDerivePrepTasksDueDates(t *testing.T) {
	rec := Recipe{
		Ingredients: []Ingredient{
			ing(12, "lb", "frozen turkey", ""),
			ing(1, "cup", "butter", "softened"),
		},
		Methods:   []string{"bake"},
		Equipment: []RecipeEquipment{{ID: "oven", Required: true}},
	}
	want := map[string]struct {
		window PrepWindow
		dueOn  string
	}{
		"thaw_frozen_large_roast:turkey": {WindowThreeDaysBefore, "2026-08-02"},
		"soften_butter:butter":           {WindowHourBefore, "2026-08-05"},
		"preheat_oven:oven":              {WindowAtStart, "2026-08-05"},
	}

	tasks := DerivePrepTasks(rec, cookDay)
	if len(tasks) != len(want) {
		t.Fatalf("got %d tasks (%v), want %d", len(tasks), taskKeys(tasks), len(want))
	}
	for _, task := range tasks {
		w, ok := want[task.Key]
		if !ok {
			t.Fatalf("unexpected task %q", task.Key)
		}
		if task.Window != w.window {
			t.Errorf("%s: window = %q, want %q", task.Key, task.Window, w.window)
		}
		if task.DueOn != w.dueOn {
			t.Errorf("%s: dueOn = %q, want %q", task.Key, task.DueOn, w.dueOn)
		}
		if task.Source != PrepSourceRule {
			t.Errorf("%s: source = %q, want %q", task.Key, task.Source, PrepSourceRule)
		}
	}
	// Coarsest window first: the three-day thaw is the one most likely to be
	// missed, so it must not sort below "preheat the oven".
	if tasks[0].Key != "thaw_frozen_large_roast:turkey" {
		t.Errorf("first task = %q, want the three-days-before thaw", tasks[0].Key)
	}
}

// A lead time that crosses a month boundary is where naive day arithmetic
// breaks, and a thaw scheduled on the 0th of August is a task that never fires.
func TestDueOnCrossesMonthBoundary(t *testing.T) {
	rec := Recipe{Ingredients: []Ingredient{ing(12, "lb", "frozen turkey", "")}}
	tasks := DerivePrepTasks(rec, time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC))
	if len(tasks) != 1 {
		t.Fatalf("got %d tasks, want 1", len(tasks))
	}
	if tasks[0].DueOn != "2026-08-29" {
		t.Errorf("dueOn = %q, want 2026-08-29", tasks[0].DueOn)
	}
}

// The cook date is an argument, not a clock read: the same recipe planned for a
// different day must produce the same tasks on different dates.
func TestDerivationDependsOnCookDateNotNow(t *testing.T) {
	rec := Recipe{Ingredients: []Ingredient{ing(2, "lb", "frozen chicken breast", "")}}
	a := DerivePrepTasks(rec, time.Date(2026, 8, 5, 0, 0, 0, 0, time.UTC))
	b := DerivePrepTasks(rec, time.Date(2026, 12, 25, 0, 0, 0, 0, time.UTC))
	if len(a) != 1 || len(b) != 1 {
		t.Fatalf("got %d and %d tasks, want 1 each", len(a), len(b))
	}
	if a[0].Key != b[0].Key {
		t.Errorf("keys differ across cook dates: %q vs %q", a[0].Key, b[0].Key)
	}
	if a[0].DueOn != "2026-08-04" || b[0].DueOn != "2026-12-24" {
		t.Errorf("dueOn = %q and %q, want 2026-08-04 and 2026-12-24", a[0].DueOn, b[0].DueOn)
	}
}

func TestMarkMissed(t *testing.T) {
	rec := Recipe{
		Ingredients: []Ingredient{ing(12, "lb", "frozen turkey", "")},
		Methods:     []string{"bake"},
	}
	tasks := DerivePrepTasks(rec, cookDay) // due 2026-08-02 and 2026-08-05

	// The morning of the cook: the three-day thaw is long gone. It is still in
	// the list — a forgotten thaw is exactly what the cook needs to be told.
	got := MarkMissed(tasks, "2026-08-05")
	if len(got) != 2 {
		t.Fatalf("got %d tasks, want 2 — a missed task must never be dropped", len(got))
	}
	if !got[0].Missed {
		t.Errorf("%s: missed = false, want true (due %s)", got[0].Key, got[0].DueOn)
	}
	if got[1].Missed {
		t.Errorf("%s: missed = true, want false (due %s today)", got[1].Key, got[1].DueOn)
	}

	// Planning ahead: nothing is missed yet.
	for _, task := range MarkMissed(tasks, "2026-08-01") {
		if task.Missed {
			t.Errorf("%s: missed = true a week out", task.Key)
		}
	}
	// No "today" supplied means no claim either way.
	for _, task := range MarkMissed(tasks, "") {
		if task.Missed {
			t.Errorf("%s: missed = true without a today", task.Key)
		}
	}
}

// Keys are the check-off identity and BL-0044's merge key. Editing a rule's
// text must preserve them; this pins that the key is built from the rule id and
// the subject and nothing else.
func TestKeysAreStableAcrossTextEdits(t *testing.T) {
	rec := Recipe{Ingredients: []Ingredient{ing(2, "lb", "frozen chicken breast", "")}}
	before := DerivePrepTasks(rec, cookDay)

	edited, err := loadPrepRules([]byte(`{
	  "version": "test.2",
	  "rules": [{
	    "id": "thaw_frozen_protein",
	    "when": { "category": "protein", "ingredientState": "frozen" },
	    "window": "night_before",
	    "text": "Totally different wording about the {item}",
	    "priority": 100
	  }]
	}`), normalizer.Categories(), equipmentCatalog)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	after := edited.derive(rec, cookDay)

	if len(before) != 1 || len(after) != 1 {
		t.Fatalf("got %d and %d tasks, want 1 each", len(before), len(after))
	}
	if before[0].Key != after[0].Key {
		t.Errorf("a text edit changed the key: %q -> %q", before[0].Key, after[0].Key)
	}
	if before[0].Text == after[0].Text {
		t.Error("the text did not actually change; the test proves nothing")
	}
}

// {item} is what makes one rule serve every protein. If it stops interpolating,
// every task reads "Move the {item} to the fridge" and nobody notices in a key
// assertion.
func TestTextInterpolatesTheSubject(t *testing.T) {
	rec := Recipe{
		Ingredients: []Ingredient{ing(1, "lb", "frozen salmon", "")},
		Equipment:   []RecipeEquipment{{ID: "skewers", Required: true}},
	}
	for _, task := range DerivePrepTasks(rec, cookDay) {
		if strings.Contains(task.Text, "{") {
			t.Errorf("%s: uninterpolated placeholder in %q", task.Key, task.Text)
		}
	}
	tasks := DerivePrepTasks(Recipe{Ingredients: []Ingredient{ing(1, "lb", "frozen salmon", "")}}, cookDay)
	if len(tasks) != 1 || tasks[0].Text != "Move the salmon to the fridge to thaw" {
		t.Errorf("text = %q, want the salmon named in it", tasks[0].Text)
	}
}
