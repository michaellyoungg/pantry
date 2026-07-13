package recipe

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
)

// maxBodyBytes caps request payloads to bound memory use and slow-body abuse.
const maxBodyBytes = 1 << 20 // 1 MiB

func NewRouter(store Store, secret string) http.Handler {
	return NewRouterWithImporter(store, secret, nil)
}

// NewRouterWithImporter is NewRouter plus URL import. imp may be nil, in which
// case POST /recipes/import responds 503 (import not configured).
func NewRouterWithImporter(store Store, secret string, imp *Importer) http.Handler {
	h := &handlers{store: store, importer: imp}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", h.healthz)
	mux.HandleFunc("POST /recipes", h.createRecipe)
	mux.HandleFunc("GET /recipes", h.listRecipes)
	mux.HandleFunc("GET /recipes/{id}", h.getRecipe)
	mux.HandleFunc("GET /catalog", h.listCatalog)
	mux.HandleFunc("DELETE /recipes/{id}", h.deleteRecipe)
	mux.HandleFunc("PUT /recipes/{id}", h.updateRecipe)
	mux.HandleFunc("POST /recipes/import", h.importRecipe)
	mux.HandleFunc("POST /grocery-list", h.groceryList)
	return requireService(secret, mux)
}

type handlers struct {
	store    Store
	importer *Importer
}

func (h *handlers) healthz(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *handlers) createRecipe(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Title       string       `json:"title"`
		Ingredients []Ingredient `json:"ingredients"`
		Steps       []string     `json:"steps"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	if strings.TrimSpace(req.Title) == "" {
		writeError(w, http.StatusBadRequest, "title is required")
		return
	}
	rec, err := h.store.CreateRecipe(r.Context(), userIDFrom(r.Context()), req.Title, req.Ingredients, req.Steps)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not create recipe")
		return
	}
	writeJSON(w, http.StatusCreated, rec)
}

func (h *handlers) listRecipes(w http.ResponseWriter, r *http.Request) {
	recs, err := h.store.ListRecipes(r.Context(), userIDFrom(r.Context()))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not list recipes")
		return
	}
	writeJSON(w, http.StatusOK, recs)
}

func (h *handlers) listCatalog(w http.ResponseWriter, r *http.Request) {
	recs, err := h.store.ListRecipes(r.Context(), CatalogUserID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not list catalog")
		return
	}
	writeJSON(w, http.StatusOK, recs)
}

func (h *handlers) getRecipe(w http.ResponseWriter, r *http.Request) {
	rec, err := h.store.GetRecipe(r.Context(), r.PathValue("id"), userIDFrom(r.Context()))
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
	err := h.store.DeleteRecipe(r.Context(), r.PathValue("id"), userIDFrom(r.Context()))
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
		Steps       []string     `json:"steps"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	if strings.TrimSpace(req.Title) == "" {
		writeError(w, http.StatusBadRequest, "title is required")
		return
	}
	rec, err := h.store.UpdateRecipe(r.Context(), r.PathValue("id"), userIDFrom(r.Context()), req.Title, req.Ingredients, req.Steps)
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

func (h *handlers) importRecipe(w http.ResponseWriter, r *http.Request) {
	if h.importer == nil {
		writeError(w, http.StatusServiceUnavailable, "import is not configured")
		return
	}
	var req struct {
		URL string `json:"url"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	if strings.TrimSpace(req.URL) == "" {
		writeError(w, http.StatusBadRequest, "url is required")
		return
	}
	rec, err := h.importer.Import(r.Context(), userIDFrom(r.Context()), req.URL)
	switch {
	case errors.Is(err, ErrImportBadURL):
		writeError(w, http.StatusBadRequest, "invalid or disallowed url")
	case errors.Is(err, ErrImportFetch):
		writeError(w, http.StatusBadGateway, "could not fetch the url")
	case errors.Is(err, ErrImportUnparseable):
		writeError(w, http.StatusUnprocessableEntity, "could not extract a recipe from this page; enter it manually")
	case err != nil:
		writeError(w, http.StatusInternalServerError, "could not import recipe")
	default:
		writeJSON(w, http.StatusOK, rec)
	}
}

func (h *handlers) groceryList(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Items []struct {
			RecipeID   string  `json:"recipeId"`
			Multiplier float64 `json:"multiplier"`
		} `json:"items"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}

	ids := make([]string, 0, len(req.Items))
	seen := map[string]bool{}
	for _, it := range req.Items {
		if !seen[it.RecipeID] {
			seen[it.RecipeID] = true
			ids = append(ids, it.RecipeID)
		}
	}
	recs, err := h.store.GetRecipesByIDs(r.Context(), userIDFrom(r.Context()), ids)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load recipes")
		return
	}
	byID := make(map[string]Recipe, len(recs))
	for _, rec := range recs {
		byID[rec.ID] = rec
	}

	entries := make([]ScaledRecipe, 0, len(req.Items))
	for _, it := range req.Items {
		if rec, ok := byID[it.RecipeID]; ok {
			entries = append(entries, ScaledRecipe{Recipe: rec, Multiplier: it.Multiplier})
		}
	}
	writeJSON(w, http.StatusOK, AggregateScaled(entries))
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
