package recipe

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"
)

var ErrNotFound = errors.New("recipe not found")

// copyIntPtr defensively copies a nullable int (servings, totalMinutes).
// MemoryStore hands recipes back by value, so without this the caller and the
// store would share one *int and a write through either would alias the other.
func copyIntPtr(n *int) *int {
	if n == nil {
		return nil
	}
	v := *n
	return &v
}

// Store persists recipes. On the two mutating methods, a nil *int field is
// "unknown"; update replaces the whole RecipeInput, so a nil there clears a
// previously known value rather than leaving it in place.
type Store interface {
	CreateRecipe(ctx context.Context, userID string, in RecipeInput) (Recipe, error)
	GetRecipe(ctx context.Context, id, userID string) (Recipe, error)
	ListRecipes(ctx context.Context, userID string) ([]Recipe, error)
	GetRecipesByIDs(ctx context.Context, userID string, ids []string) ([]Recipe, error)
	DeleteRecipe(ctx context.Context, id, userID string) error
	UpdateRecipe(ctx context.Context, id, userID string, in RecipeInput) (Recipe, error)
	UpsertRecipe(ctx context.Context, rec Recipe) error
	// FindCloneOf returns userID's existing clone of sourceRecipeID, or
	// ErrNotFound. It is what makes clone-on-add idempotent.
	FindCloneOf(ctx context.Context, userID, sourceRecipeID string) (Recipe, error)
	// ReplacePrepTasks swaps out one producer's stored prep for a recipe
	// (BL-0044), leaving the other producer's rows alone.
	//
	// Its own method rather than a RecipeInput field because the two producers
	// write at different times and neither owns the other's rows: saving the
	// edit form must not delete what the model tagged at import, and
	// re-importing must not delete what the cook typed. That is the one place
	// this store deviates from "a write replaces the whole recipe".
	ReplacePrepTasks(ctx context.Context, recipeID, source string, tasks []StoredPrepTask) error
}

// applyInput writes in onto rec, normalizing every collection so the JSON
// contract stays [] rather than null. Shared by both stores' create/update so
// the two can never disagree about what "replace the recipe" means.
func applyInput(rec *Recipe, in RecipeInput) {
	rec.Title = in.Title
	rec.Servings = copyIntPtr(in.Servings)
	rec.Ingredients = normIngredients(in.Ingredients)
	rec.Steps = normSteps(in.Steps)
	rec.Equipment = normEquipment(in.Equipment)
	rec.Methods = normMethods(in.Methods)
	rec.Cuisine = in.Cuisine
	rec.TotalMinutes = copyIntPtr(in.TotalMinutes)
	rec.Tags = normTags(in.Tags)
	rec.SourceURL = in.SourceURL
	// SourceRecipeID is intentionally NOT written here. applyInput is the
	// "replace the recipe" path shared by create and update; provenance must
	// survive an edit, so the two stores set it only on insert.
	//
	// Neither is PrepTasks: see the Store interface.
	rec.PrepTasks = normPrepTasks(rec.PrepTasks)
}

// normSlice replaces a nil slice with an empty one so recipes always marshal
// ingredients/steps as [] rather than null, matching the wire contract.
func normIngredients(ings []Ingredient) []Ingredient {
	if ings == nil {
		return []Ingredient{}
	}
	return ings
}

func normSteps(steps []string) []string {
	if steps == nil {
		return []string{}
	}
	return steps
}

type MemoryStore struct {
	mu    sync.Mutex
	seq   int
	byID  map[string]Recipe
	order []string
}

func NewMemoryStore() *MemoryStore {
	return &MemoryStore{byID: map[string]Recipe{}}
}

func (s *MemoryStore) CreateRecipe(_ context.Context, userID string, in RecipeInput) (Recipe, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.seq++
	rec := Recipe{
		ID:             fmt.Sprintf("r%d", s.seq),
		UserID:         userID,
		SourceRecipeID: in.SourceRecipeID,
		CreatedAt:      time.Now().UTC().Truncate(time.Microsecond),
	}
	applyInput(&rec, in)
	s.byID[rec.ID] = rec
	s.order = append(s.order, rec.ID)
	return rec, nil
}

func (s *MemoryStore) GetRecipe(_ context.Context, id, userID string) (Recipe, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	rec, ok := s.byID[id]
	if !ok || rec.UserID != userID {
		return Recipe{}, ErrNotFound
	}
	return rec, nil
}

func (s *MemoryStore) ListRecipes(_ context.Context, userID string) ([]Recipe, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := []Recipe{}
	for _, id := range s.order {
		if rec := s.byID[id]; rec.UserID == userID {
			out = append(out, rec)
		}
	}
	return out, nil
}

func (s *MemoryStore) DeleteRecipe(_ context.Context, id, userID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if rec, ok := s.byID[id]; !ok || rec.UserID != userID {
		return ErrNotFound
	}
	delete(s.byID, id)
	for i, oid := range s.order {
		if oid == id {
			s.order = append(s.order[:i], s.order[i+1:]...)
			break
		}
	}
	return nil
}

func (s *MemoryStore) UpdateRecipe(_ context.Context, id, userID string, in RecipeInput) (Recipe, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	rec, ok := s.byID[id]
	if !ok || rec.UserID != userID {
		return Recipe{}, ErrNotFound
	}
	applyInput(&rec, in)
	s.byID[id] = rec
	return rec, nil
}

func (s *MemoryStore) ReplacePrepTasks(_ context.Context, recipeID, source string, tasks []StoredPrepTask) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	rec, ok := s.byID[recipeID]
	if !ok {
		return ErrNotFound
	}
	rec.PrepTasks = replacePrepSource(rec.PrepTasks, source, tasks)
	s.byID[recipeID] = rec
	return nil
}

func (s *MemoryStore) FindCloneOf(_ context.Context, userID, sourceRecipeID string) (Recipe, error) {
	if sourceRecipeID == "" {
		return Recipe{}, ErrNotFound
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	// Oldest first: order is insertion order, so a user who somehow has two
	// clones (created before this was idempotent) keeps getting the same one.
	for _, id := range s.order {
		if rec := s.byID[id]; rec.UserID == userID && rec.SourceRecipeID == sourceRecipeID {
			return rec, nil
		}
	}
	return Recipe{}, ErrNotFound
}

func (s *MemoryStore) GetRecipesByIDs(_ context.Context, userID string, ids []string) ([]Recipe, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := []Recipe{}
	for _, id := range ids {
		if rec, ok := s.byID[id]; ok && rec.UserID == userID {
			out = append(out, rec)
		}
	}
	return out, nil
}

// UpsertRecipe inserts rec, or replaces the existing row with the same id. On
// replace the original CreatedAt is preserved so catalog ordering stays stable.
func (s *MemoryStore) UpsertRecipe(_ context.Context, rec Recipe) error {
	if rec.ID == "" {
		return errors.New("upsert: recipe id is required")
	}
	applyInput(&rec, inputFrom(rec))
	// Unlike create/update, upsert carries provenance through verbatim — it is
	// the raw-row write path used by the catalog seeder.
	s.mu.Lock()
	defer s.mu.Unlock()
	if existing, ok := s.byID[rec.ID]; ok {
		rec.CreatedAt = existing.CreatedAt
		rec.PrepTasks = overlayPrepBySource(existing.PrepTasks, rec.PrepTasks)
	} else {
		if rec.CreatedAt.IsZero() {
			rec.CreatedAt = time.Now().UTC().Truncate(time.Microsecond)
		}
		s.order = append(s.order, rec.ID)
	}
	s.byID[rec.ID] = rec
	return nil
}
