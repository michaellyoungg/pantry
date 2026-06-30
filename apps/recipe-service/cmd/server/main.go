package main

import (
	"context"
	"log"
	"net/http"
	"os"

	"pantry/apps/recipe-service/internal/recipe"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	var store recipe.Store
	if dsn := os.Getenv("DATABASE_URL"); dsn != "" {
		pg, err := recipe.NewPostgresStore(context.Background(), dsn)
		if err != nil {
			log.Fatalf("postgres: %v", err)
		}
		defer pg.Close()
		store = pg
		log.Print("using Postgres store")
	} else {
		store = recipe.NewMemoryStore()
		log.Print("DATABASE_URL unset; using in-memory store")
	}

	log.Printf("recipe-service listening on :%s", port)
	if err := http.ListenAndServe(":"+port, recipe.NewRouter(store)); err != nil {
		log.Fatal(err)
	}
}
