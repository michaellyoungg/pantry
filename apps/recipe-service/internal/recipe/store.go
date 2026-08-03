package recipe

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"
)

var ErrNotFound = errors.New("recipe not found")

// copyServings defensively copies a nullable serving count. MemoryStore hands
// recipes back by value, so without this the caller and the store would share
// one *int and a write through either would alias the other.
func copyServings(n *int) *int {
	if n == nil {
		return nil
	}
	v := *n
	return &v
}

// Store persists recipes. On the two mutating methods, servings is nil for
// "unknown"; update replaces it wholesale like the rest of the recipe, so a nil
// there clears a previously known yield.
type Store interface {
	CreateRecipe(ctx context.Context, userID, title string, servings *int, ings []Ingredient, steps []string, equip []RecipeEquipment, methods []string) (Recipe, error)
	GetRecipe(ctx context.Context, id, userID string) (Recipe, error)
	ListRecipes(ctx context.Context, userID string) ([]Recipe, error)
	GetRecipesByIDs(ctx context.Context, userID string, ids []string) ([]Recipe, error)
	DeleteRecipe(ctx context.Context, id, userID string) error
	UpdateRecipe(ctx context.Context, id, userID, title string, servings *int, ings []Ingredient, steps []string, equip []RecipeEquipment, methods []string) (Recipe, error)
	UpsertRecipe(ctx context.Context, rec Recipe) error
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

func (s *MemoryStore) CreateRecipe(_ context.Context, userID, title string, servings *int, ings []Ingredient, steps []string, equip []RecipeEquipment, methods []string) (Recipe, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.seq++
	rec := Recipe{
		ID:          fmt.Sprintf("r%d", s.seq),
		UserID:      userID,
		Title:       title,
		Servings:    copyServings(servings),
		Ingredients: normIngredients(ings),
		Steps:       normSteps(steps),
		Equipment:   normEquipment(equip),
		Methods:     normMethods(methods),
		CreatedAt:   time.Now().UTC().Truncate(time.Microsecond),
	}
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

func (s *MemoryStore) UpdateRecipe(_ context.Context, id, userID, title string, servings *int, ings []Ingredient, steps []string, equip []RecipeEquipment, methods []string) (Recipe, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	rec, ok := s.byID[id]
	if !ok || rec.UserID != userID {
		return Recipe{}, ErrNotFound
	}
	rec.Title = title
	rec.Servings = copyServings(servings)
	rec.Ingredients = normIngredients(ings)
	rec.Steps = normSteps(steps)
	rec.Equipment = normEquipment(equip)
	rec.Methods = normMethods(methods)
	s.byID[id] = rec
	return rec, nil
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
	rec.Servings = copyServings(rec.Servings)
	rec.Ingredients = normIngredients(rec.Ingredients)
	rec.Steps = normSteps(rec.Steps)
	rec.Equipment = normEquipment(rec.Equipment)
	rec.Methods = normMethods(rec.Methods)
	s.mu.Lock()
	defer s.mu.Unlock()
	if existing, ok := s.byID[rec.ID]; ok {
		rec.CreatedAt = existing.CreatedAt
	} else {
		if rec.CreatedAt.IsZero() {
			rec.CreatedAt = time.Now().UTC().Truncate(time.Microsecond)
		}
		s.order = append(s.order, rec.ID)
	}
	s.byID[rec.ID] = rec
	return nil
}
