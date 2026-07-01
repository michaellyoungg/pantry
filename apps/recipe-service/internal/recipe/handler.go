package recipe

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
)

// maxBodyBytes caps request payloads to bound memory use and slow-body abuse.
const maxBodyBytes = 1 << 20 // 1 MiB

func NewRouter(store Store) http.Handler {
	h := &handlers{store: store}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", h.healthz)
	mux.HandleFunc("POST /recipes", h.createRecipe)
	mux.HandleFunc("GET /recipes", h.listRecipes)
	mux.HandleFunc("GET /recipes/{id}", h.getRecipe)
	mux.HandleFunc("DELETE /recipes/{id}", h.deleteRecipe)
	mux.HandleFunc("PUT /recipes/{id}", h.updateRecipe)
	mux.HandleFunc("POST /grocery-list", h.groceryList)
	return mux
}

type handlers struct{ store Store }

func (h *handlers) healthz(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *handlers) createRecipe(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Title       string       `json:"title"`
		Ingredients []Ingredient `json:"ingredients"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	if strings.TrimSpace(req.Title) == "" {
		writeError(w, http.StatusBadRequest, "title is required")
		return
	}
	rec, err := h.store.CreateRecipe(r.Context(), DevUserID, req.Title, req.Ingredients)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not create recipe")
		return
	}
	writeJSON(w, http.StatusCreated, rec)
}

func (h *handlers) listRecipes(w http.ResponseWriter, r *http.Request) {
	recs, err := h.store.ListRecipes(r.Context(), DevUserID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not list recipes")
		return
	}
	writeJSON(w, http.StatusOK, recs)
}

func (h *handlers) getRecipe(w http.ResponseWriter, r *http.Request) {
	rec, err := h.store.GetRecipe(r.Context(), r.PathValue("id"))
	if errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "recipe not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not get recipe")
		return
	}
	writeJSON(w, http.StatusOK, rec)
}

func (h *handlers) deleteRecipe(w http.ResponseWriter, r *http.Request) {
	err := h.store.DeleteRecipe(r.Context(), r.PathValue("id"))
	if errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "recipe not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not delete recipe")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *handlers) updateRecipe(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Title       string       `json:"title"`
		Ingredients []Ingredient `json:"ingredients"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	if strings.TrimSpace(req.Title) == "" {
		writeError(w, http.StatusBadRequest, "title is required")
		return
	}
	rec, err := h.store.UpdateRecipe(r.Context(), r.PathValue("id"), req.Title, req.Ingredients)
	if errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "recipe not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not update recipe")
		return
	}
	writeJSON(w, http.StatusOK, rec)
}

func (h *handlers) groceryList(w http.ResponseWriter, r *http.Request) {
	var req struct {
		RecipeIDs []string `json:"recipeIds"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	recs, err := h.store.GetRecipesByIDs(r.Context(), req.RecipeIDs)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load recipes")
		return
	}
	writeJSON(w, http.StatusOK, Aggregate(recs))
}

// decodeJSON reads a JSON request body with a size cap. It writes an error
// response and returns false if the body is too large (413) or malformed (400).
func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	if err := json.NewDecoder(r.Body).Decode(dst); err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			writeError(w, http.StatusRequestEntityTooLarge, "request body too large")
			return false
		}
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return false
	}
	return true
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// WithCORS wraps a handler with permissive-but-scoped CORS for the web dev
// origin, and answers preflight OPTIONS requests directly.
func WithCORS(next http.Handler, allowedOrigin string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", allowedOrigin)
		w.Header().Add("Vary", "Origin")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
