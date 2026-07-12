package main

import (
	"context"
	"fmt"
	"log"
	"os"

	"pantry/apps/recipe-service/internal/recipe"
)

func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}

func run() error {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		return fmt.Errorf("DATABASE_URL is required to seed the catalog")
	}

	ctx := context.Background()
	store, err := recipe.NewPostgresStore(ctx, dsn)
	if err != nil {
		return fmt.Errorf("connect: %w", err)
	}
	defer store.Close()

	recipes, err := recipe.LoadCatalog()
	if err != nil {
		return fmt.Errorf("load catalog: %w", err)
	}
	for _, r := range recipes {
		if err := store.UpsertRecipe(ctx, r); err != nil {
			return fmt.Errorf("upsert %q: %w", r.ID, err)
		}
	}
	log.Printf("seeded %d catalog recipes", len(recipes))
	return nil
}
