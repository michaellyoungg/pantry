package main

import (
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
	store := recipe.NewMemoryStore() // replaced by Postgres store in the next task
	log.Printf("recipe-service listening on :%s", port)
	if err := http.ListenAndServe(":"+port, recipe.NewRouter(store)); err != nil {
		log.Fatal(err)
	}
}
