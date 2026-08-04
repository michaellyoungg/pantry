package recipe

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

// The rule task a frozen 12lb turkey produces. Hard-coded rather than derived
// so the override tests fail loudly if BL-0042's keys ever stop being stable —
// which is the assumption the whole merge rests on.
const turkeyThawKey = "thaw_frozen_large_roast:turkey"

func writeRecipe(t *testing.T, srv, method, url, body string, wantStatus int) Recipe {
	t.Helper()
	resp := doAuth(t, method, url, strings.NewReader(body))
	defer resp.Body.Close()
	if resp.StatusCode != wantStatus {
		t.Fatalf("%s %s: status %d, want %d", method, url, resp.StatusCode, wantStatus)
	}
	var rec Recipe
	if wantStatus < 300 {
		if err := json.NewDecoder(resp.Body).Decode(&rec); err != nil {
			t.Fatalf("decode recipe: %v", err)
		}
	}
	return rec
}

func prepTasksFor(t *testing.T, srv, recipeID string) []PrepTask {
	t.Helper()
	got := postPrepTasks(t, srv, `{"meals":[{"recipeId":"`+recipeID+`","cookDate":"2026-11-26"}]}`)
	if len(got.Meals) != 1 {
		t.Fatalf("got %d meals, want 1", len(got.Meals))
	}
	return got.Meals[0].Tasks
}

func TestCreateRecipe_StoresHandAuthoredPrep(t *testing.T) {
	srv, _ := newTestServer(t)

	rec := writeRecipe(t, srv.URL, http.MethodPost, srv.URL+"/recipes", `{
		"title":"Pie","ingredients":[{"quantity":1,"unit":"","item":"flour"}],
		"prepTasks":[{"window":"night_before","text":"Make the pastry and chill it"}]
	}`, http.StatusCreated)

	if len(rec.PrepTasks) != 1 {
		t.Fatalf("recipe carries %d prep tasks, want 1: %+v", len(rec.PrepTasks), rec.PrepTasks)
	}
	// The server-assigned key comes back so the client can round-trip an edit
	// rather than guess how keys are built.
	if rec.PrepTasks[0].Key != "manual:make-the-pastry-and-chill-it" {
		t.Errorf("key = %q, want the assigned key echoed back", rec.PrepTasks[0].Key)
	}
	if rec.PrepTasks[0].Source != PrepSourceManual {
		t.Errorf("source = %q, want it stamped manual by the server", rec.PrepTasks[0].Source)
	}

	tasks := prepTasksFor(t, srv.URL, rec.ID)
	if len(tasks) != 1 || tasks[0].Text != "Make the pastry and chill it" {
		t.Fatalf("prep-tasks returned %+v, want the hand-authored task", tasks)
	}
	if tasks[0].DueOn != "2026-11-25" {
		t.Errorf("dueOn = %q, want the night before the cook date", tasks[0].DueOn)
	}
}

// The point of the whole item: a hand-authored task replaces the rule that
// would have produced it instead of appearing next to it.
func TestUpdateRecipe_ManualTaskOverridesTheRuleItShadows(t *testing.T) {
	srv, store := newTestServer(t)
	rec := seedThawRecipe(t, store, "user-a", "Roast turkey")

	before := prepTasksFor(t, srv.URL, rec.ID)
	if _, ok := taskByKey(before, turkeyThawKey); !ok {
		t.Fatalf("fixture no longer produces %q: %+v", turkeyThawKey, before)
	}

	writeRecipe(t, srv.URL, http.MethodPut, srv.URL+"/recipes/"+rec.ID, `{
		"title":"Roast turkey","ingredients":[{"quantity":12,"unit":"lb","item":"frozen turkey"}],
		"methods":["roast"],
		"prepTasks":[{"key":"`+turkeyThawKey+`","window":"two_days_before","text":"Turkey into the fridge Tuesday — our fridge runs cold"}]
	}`, http.StatusOK)

	after := prepTasksFor(t, srv.URL, rec.ID)
	if len(after) != len(before) {
		t.Errorf("task count went %d -> %d; an override must replace, not add: %+v", len(before), len(after), after)
	}
	got, ok := taskByKey(after, turkeyThawKey)
	if !ok {
		t.Fatalf("key %q vanished: %+v", turkeyThawKey, after)
	}
	if got.Source != PrepSourceManual || got.Window != WindowTwoDaysBefore {
		t.Errorf("task = %+v, want the hand-authored two-days-before version", got)
	}
	if got.DueOn != "2026-11-24" {
		t.Errorf("dueOn = %q, want the override's own lead time applied", got.DueOn)
	}
}

// A client that knows nothing about prep must not be able to delete it. Every
// other field on the update is a wholesale replace; this one deliberately is
// not, because two producers write it and neither owns the other's rows.
func TestUpdateRecipe_OmittedPrepIsLeftAlone(t *testing.T) {
	srv, _ := newTestServer(t)
	rec := writeRecipe(t, srv.URL, http.MethodPost, srv.URL+"/recipes", `{
		"title":"Pie","ingredients":[{"quantity":1,"unit":"","item":"flour"}],
		"prepTasks":[{"window":"night_before","text":"Make the pastry"}]
	}`, http.StatusCreated)

	updated := writeRecipe(t, srv.URL, http.MethodPut, srv.URL+"/recipes/"+rec.ID,
		`{"title":"Pie","ingredients":[{"quantity":2,"unit":"","item":"flour"}]}`, http.StatusOK)

	if len(updated.PrepTasks) != 1 {
		t.Errorf("prep tasks = %+v, want the stored one untouched by a prep-unaware client", updated.PrepTasks)
	}
}

// …but an explicit empty array is a user clearing their own tasks, and that has
// to work or the only way out of a bad task is the database.
func TestUpdateRecipe_EmptyPrepArrayClears(t *testing.T) {
	srv, _ := newTestServer(t)
	rec := writeRecipe(t, srv.URL, http.MethodPost, srv.URL+"/recipes", `{
		"title":"Pie","ingredients":[{"quantity":1,"unit":"","item":"flour"}],
		"prepTasks":[{"window":"night_before","text":"Make the pastry"}]
	}`, http.StatusCreated)

	updated := writeRecipe(t, srv.URL, http.MethodPut, srv.URL+"/recipes/"+rec.ID,
		`{"title":"Pie","ingredients":[{"quantity":1,"unit":"","item":"flour"}],"prepTasks":[]}`, http.StatusOK)

	if len(updated.PrepTasks) != 0 {
		t.Errorf("prep tasks = %+v, want them cleared", updated.PrepTasks)
	}
	if tasks := prepTasksFor(t, srv.URL, rec.ID); len(tasks) != 0 {
		t.Errorf("prep-tasks still returns %+v", tasks)
	}
}

func TestCreateRecipe_RejectsInvalidPrep(t *testing.T) {
	srv, _ := newTestServer(t)
	cases := map[string]string{
		"unknown window":   `{"window":"someday","text":"Do the thing"}`,
		"claimed source":   `{"window":"at_start","text":"Do the thing","source":"llm"}`,
		"no window at all": `{"text":"Do the thing"}`,
	}
	for name, task := range cases {
		t.Run(name, func(t *testing.T) {
			writeRecipe(t, srv.URL, http.MethodPost, srv.URL+"/recipes",
				`{"title":"Pie","ingredients":[],"prepTasks":[`+task+`]}`, http.StatusBadRequest)
		})
	}
}

// A rejected task must not leave a recipe behind: validation runs before the
// write, so a 400 means nothing happened at all.
func TestCreateRecipe_InvalidPrepCreatesNothing(t *testing.T) {
	srv, store := newTestServer(t)

	writeRecipe(t, srv.URL, http.MethodPost, srv.URL+"/recipes",
		`{"title":"Pie","ingredients":[],"prepTasks":[{"window":"someday","text":"x"}]}`,
		http.StatusBadRequest)

	recs, err := store.ListRecipes(t.Context(), "user-a")
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(recs) != 0 {
		t.Errorf("%d recipes were created by a rejected request", len(recs))
	}
}

// Model-derived tasks and hand-authored ones are written by different callers
// and neither may clobber the other.
func TestReplacePrepTasks_IsScopedToOneSource(t *testing.T) {
	srv, store := newTestServer(t)
	ctx := t.Context()
	rec := writeRecipe(t, srv.URL, http.MethodPost, srv.URL+"/recipes", `{
		"title":"Pie","ingredients":[{"quantity":1,"unit":"","item":"flour"}],
		"prepTasks":[{"window":"night_before","text":"Make the pastry"}]
	}`, http.StatusCreated)

	llm, err := NormalizePrepTasks([]StoredPrepTask{
		{Window: WindowAtStart, Text: "Blind bake the shell"},
	}, PrepSourceLLM)
	if err != nil {
		t.Fatalf("normalize: %v", err)
	}
	if err := store.ReplacePrepTasks(ctx, rec.ID, PrepSourceLLM, llm); err != nil {
		t.Fatalf("replace llm prep: %v", err)
	}

	// The manual save the user makes next must not delete what import stored.
	updated := writeRecipe(t, srv.URL, http.MethodPut, srv.URL+"/recipes/"+rec.ID, `{
		"title":"Pie","ingredients":[{"quantity":1,"unit":"","item":"flour"}],
		"prepTasks":[{"window":"night_before","text":"Make the pastry the night before"}]
	}`, http.StatusOK)

	bySource := map[string]int{}
	for _, task := range updated.PrepTasks {
		bySource[task.Source]++
	}
	if bySource[PrepSourceLLM] != 1 || bySource[PrepSourceManual] != 1 {
		t.Errorf("sources = %v, want one of each: %+v", bySource, updated.PrepTasks)
	}
}
