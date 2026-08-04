package recipe

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

func postPrepTasks(t *testing.T, srv, body string) PrepTasksResponse {
	t.Helper()
	resp := doAuth(t, http.MethodPost, srv+"/prep-tasks", strings.NewReader(body))
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("POST /prep-tasks: status %d", resp.StatusCode)
	}
	var got PrepTasksResponse
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatalf("decode prep tasks: %v", err)
	}
	return got
}

// seedThawRecipe stores a recipe whose prep is unambiguous: a frozen turkey
// big enough to need the three-day thaw.
func seedThawRecipe(t *testing.T, store Store, userID, title string) Recipe {
	t.Helper()
	rec, err := store.CreateRecipe(t.Context(), userID, title, nil,
		[]Ingredient{{Quantity: 12, Unit: "lb", Item: "frozen turkey"}},
		nil, nil, []string{"roast"})
	if err != nil {
		t.Fatalf("create recipe: %v", err)
	}
	return rec
}

func TestPrepTasksEndpoint(t *testing.T) {
	srv, store := newTestServer(t)
	rec := seedThawRecipe(t, store, "user-a", "Roast turkey")

	got := postPrepTasks(t, srv.URL, `{"meals":[{"recipeId":"`+rec.ID+`","cookDate":"2026-11-26"}]}`)

	if got.RulesVersion == "" {
		t.Error("rulesVersion is empty; the output cannot be traced to a rule revision")
	}
	if len(got.Meals) != 1 {
		t.Fatalf("got %d meals, want 1", len(got.Meals))
	}
	meal := got.Meals[0]
	if meal.RecipeID != rec.ID || meal.CookDate != "2026-11-26" {
		t.Errorf("meal = %+v, want the request echoed back", meal)
	}
	if meal.Title != "Roast turkey" {
		t.Errorf("Title = %q, want the recipe title so tasks can be labelled", meal.Title)
	}
	if len(meal.Tasks) != 2 {
		t.Fatalf("got %d tasks (%v), want the thaw and the preheat", len(meal.Tasks), taskKeys(meal.Tasks))
	}
	thaw := meal.Tasks[0]
	if thaw.Key != "thaw_frozen_large_roast:turkey" {
		t.Errorf("first task = %q, want the long thaw", thaw.Key)
	}
	// The whole point of the feature: derived against the COOK date, so the
	// thaw lands three days out and not on the day you cook.
	if thaw.DueOn != "2026-11-23" {
		t.Errorf("dueOn = %q, want 2026-11-23 (three days before the cook date)", thaw.DueOn)
	}
	if thaw.Missed {
		t.Error("missed = true without a `today` in the request")
	}
}

func TestPrepTasksMarksPassedWindowsMissed(t *testing.T) {
	srv, store := newTestServer(t)
	rec := seedThawRecipe(t, store, "user-a", "Roast turkey")

	// Asking on the morning of the cook: the three-day thaw is long past.
	got := postPrepTasks(t, srv.URL,
		`{"today":"2026-11-26","meals":[{"recipeId":"`+rec.ID+`","cookDate":"2026-11-26"}]}`)

	tasks := got.Meals[0].Tasks
	if len(tasks) != 2 {
		t.Fatalf("got %d tasks, want 2 — a missed task must be reported, not dropped", len(tasks))
	}
	if !tasks[0].Missed {
		t.Errorf("%s (due %s) is not marked missed", tasks[0].Key, tasks[0].DueOn)
	}
	if tasks[1].Missed {
		t.Errorf("%s (due %s today) is marked missed", tasks[1].Key, tasks[1].DueOn)
	}
}

// A catalog recipe is owned by CatalogUserID but plannable by anyone. Without
// the dual-scope lookup, every catalog meal in a plan derives to nothing.
func TestPrepTasksResolvesCatalogRecipes(t *testing.T) {
	srv, store := newTestServer(t)
	rec := seedThawRecipe(t, store, CatalogUserID, "Catalog turkey")

	resp := doAuthAs(t, http.MethodPost, srv.URL+"/prep-tasks", "someone-else",
		strings.NewReader(`{"meals":[{"recipeId":"`+rec.ID+`","cookDate":"2026-11-26"}]}`))
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status %d", resp.StatusCode)
	}
	var got PrepTasksResponse
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(got.Meals) != 1 || len(got.Meals[0].Tasks) == 0 {
		t.Fatalf("catalog recipe derived no tasks: %+v", got.Meals)
	}
}

// Another user's private recipe must not leak prep — the tasks name its
// ingredients.
func TestPrepTasksDoesNotLeakOtherUsersRecipes(t *testing.T) {
	srv, store := newTestServer(t)
	rec := seedThawRecipe(t, store, "someone-else", "Their turkey")

	got := postPrepTasks(t, srv.URL, `{"meals":[{"recipeId":"`+rec.ID+`","cookDate":"2026-11-26"}]}`)
	if len(got.Meals) != 0 {
		t.Errorf("got %+v, want no meals for an unreadable recipe", got.Meals)
	}
}

func TestPrepTasksRejectsBadDates(t *testing.T) {
	srv, store := newTestServer(t)
	rec := seedThawRecipe(t, store, "user-a", "Roast turkey")

	for _, body := range []string{
		`{"meals":[{"recipeId":"` + rec.ID + `","cookDate":"26/11/2026"}]}`,
		`{"meals":[{"recipeId":"` + rec.ID + `","cookDate":""}]}`,
		// A rolled-over date is a client bug, not something to silently accept
		// as the 3rd of March.
		`{"meals":[{"recipeId":"` + rec.ID + `","cookDate":"2026-02-31"}]}`,
		`{"today":"nope","meals":[{"recipeId":"` + rec.ID + `","cookDate":"2026-11-26"}]}`,
	} {
		resp := doAuth(t, http.MethodPost, srv.URL+"/prep-tasks", strings.NewReader(body))
		resp.Body.Close()
		if resp.StatusCode != http.StatusBadRequest {
			t.Errorf("%s: status %d, want 400", body, resp.StatusCode)
		}
	}
}

func TestPrepTasksEmptyRequest(t *testing.T) {
	srv, _ := newTestServer(t)
	got := postPrepTasks(t, srv.URL, `{"meals":[]}`)
	if len(got.Meals) != 0 {
		t.Errorf("got %d meals for an empty plan", len(got.Meals))
	}
}

func TestPrepTasksRequiresServiceSecret(t *testing.T) {
	srv, _ := newTestServer(t)
	resp, err := http.Post(srv.URL+"/prep-tasks", "application/json", strings.NewReader(`{"meals":[]}`))
	if err != nil {
		t.Fatalf("POST: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("status %d, want 401", resp.StatusCode)
	}
}
