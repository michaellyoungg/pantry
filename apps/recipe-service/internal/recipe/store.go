package recipe

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"
)

var ErrNotFound = errors.New("recipe not found")

type Store interface {
	CreateRecipe(ctx context.Context, userID, title string, ings []Ingredient) (Recipe, error)
	GetRecipe(ctx context.Context, id, userID string) (Recipe, error)
	ListRecipes(ctx context.Context, userID string) ([]Recipe, error)
	GetRecipesByIDs(ctx context.Context, userID string, ids []string) ([]Recipe, error)
	DeleteRecipe(ctx context.Context, id, userID string) error
	UpdateRecipe(ctx context.Context, id, userID, title string, ings []Ingredient) (Recipe, error)
}

type MemoryStore struct {
	mu     sync.Mutex
	seq    int
	byID   map[string]Recipe
	order  []string
}

func NewMemoryStore() *MemoryStore {
	return &MemoryStore{byID: map[string]Recipe{}}
}

func (s *MemoryStore) CreateRecipe(_ context.Context, userID, title string, ings []Ingredient) (Recipe, error) {
	if ings == nil {
		ings = []Ingredient{}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.seq++
	rec := Recipe{
		ID:          fmt.Sprintf("r%d", s.seq),
		UserID:      userID,
		Title:       title,
		Ingredients: ings,
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

func (s *MemoryStore) UpdateRecipe(_ context.Context, id, userID, title string, ings []Ingredient) (Recipe, error) {
	if ings == nil {
		ings = []Ingredient{}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	rec, ok := s.byID[id]
	if !ok || rec.UserID != userID {
		return Recipe{}, ErrNotFound
	}
	rec.Title = title
	rec.Ingredients = ings
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
