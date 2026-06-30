package main

import (
	"log"
	"net/http"
	"os"

	"pantry/apps/recipe-service/internal/recipe"
)

func main() {
	addr := os.Getenv("PORT")
	if addr == "" {
		addr = "8080"
	}
	log.Printf("recipe-service listening on :%s", addr)
	if err := http.ListenAndServe(":"+addr, recipe.NewRouter()); err != nil {
		log.Fatal(err)
	}
}
