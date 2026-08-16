package recipe

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"

	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel/codes"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
	"go.opentelemetry.io/otel/trace"
)

// maxBodyBytes caps request payloads to bound memory use and slow-body abuse.
const maxBodyBytes = 1 << 20 // 1 MiB

func NewRouter(store Store, secret string) http.Handler {
	return NewRouterWithImporter(store, secret, nil)
}

// traced renames the active server span to the matched route pattern. otelhttp
// wraps the router before ServeMux has matched anything, so r.Pattern — which
// the mux fills in during routing — is only available here, inside the handler.
// Naming spans from the raw path instead would put recipe ids into span names
// and blow up cardinality in Tempo.
func traced(fn http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if span := trace.SpanFromContext(r.Context()); span.IsRecording() && r.Pattern != "" {
			span.SetName(r.Pattern)
			span.SetAttributes(semconv.HTTPRoute(r.Pattern))
		}
		fn(w, r)
	}
}

// NewRouterWithImporter is NewRouter plus URL import. imp may be nil, in which
// case POST /recipes/import responds 503 (import not configured). Further
// optional surfaces arrive as opts (see WithNutrition).
func NewRouterWithImporter(store Store, secret string, imp *Importer, opts ...RouterOption) http.Handler {
	h := &handlers{store: store, importer: imp}
	for _, opt := range opts {
		opt(h)
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", traced(h.healthz))
	mux.HandleFunc("POST /recipes", traced(h.createRecipe))
	mux.HandleFunc("GET /recipes", traced(h.listRecipes))
	mux.HandleFunc("GET /recipes/{id}", traced(h.getRecipe))
	mux.HandleFunc("GET /recipes/{id}/nutrition", traced(h.recipeNutrition))
	mux.HandleFunc("GET /catalog", traced(h.listCatalog))
	mux.HandleFunc("POST /catalog/{id}/add", traced(h.addFromCatalog))
	mux.HandleFunc("GET /equipment", traced(h.listEquipment))
	mux.HandleFunc("DELETE /recipes/{id}", traced(h.deleteRecipe))
	mux.HandleFunc("PUT /recipes/{id}", traced(h.updateRecipe))
	mux.HandleFunc("POST /recipes/import", traced(h.importRecipe))
	mux.HandleFunc("POST /grocery-list", traced(h.groceryList))
	mux.HandleFunc("POST /normalization/lookup", traced(h.normalizationLookup))
	mux.HandleFunc("POST /normalization/avoid", traced(h.normalizationAvoid))
	mux.HandleFunc("GET /normalization/coverage", traced(h.normalizationCoverage))
	mux.HandleFunc("POST /equipment/match", traced(h.equipmentMatch))
	mux.HandleFunc("POST /pricing/estimate", traced(h.pricingEstimate))
	mux.HandleFunc("POST /nutrition/estimate", traced(h.nutritionEstimate))
	mux.HandleFunc("POST /recommendations/pantry", traced(h.recommendPantry))
	mux.HandleFunc("POST /recommendations/discover", traced(h.recommendDiscover))
	mux.HandleFunc("POST /prep-tasks", traced(h.prepTasks))

	// otelhttp sits OUTSIDE requireService so rejected requests are traced too —
	// an auth failure is precisely when you want to see the request.
	return otelhttp.NewHandler(requireService(secret, mux), "recipe-service")
}

type handlers struct {
	store     Store
	importer  *Importer
	nutrition NutritionEstimator
	// generator invents recommendation candidates when the corpus is thin
	// (BL-0034). Nil unless WithGenerator was passed, which is the default:
	// no key, no generated candidates, no errors.
	generator Generator
}

func (h *handlers) healthz(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// recipeBody is the wire shape of a recipe write. Create and update accept
// exactly the same fields — update replaces the recipe wholesale — so they share
// one struct and one validator rather than drifting apart field by field.
type recipeBody struct {
	Title string `json:"title"`
	// Absent or null means "yield unknown" (BL-0035).
	Servings    *int              `json:"servings"`
	Ingredients []Ingredient      `json:"ingredients"`
	Steps       []string          `json:"steps"`
	Equipment   []RecipeEquipment `json:"equipment"`
	Methods     []string          `json:"methods"`
	// Discovery metadata (BL-0020). Absent totalMinutes is "unknown", not zero.
	Cuisine      string   `json:"cuisine"`
	TotalMinutes *int     `json:"totalMinutes"`
	Tags         []string `json:"tags"`
	SourceURL    string   `json:"sourceUrl"`
	// Prep tasks (BL-0044). Unlike every field above, an ABSENT value does not
	// clear the stored rows: two producers write them independently, so a
	// client that knows nothing about prep must not be able to delete what the
	// model tagged at import. Send [] to clear.
	PrepTasks []StoredPrepTask `json:"prepTasks"`
}

// validatedInput checks a decoded recipe body and turns it into the store's
// input, writing the error response itself on failure. ok is false when the
// caller should stop.
func validatedInput(w http.ResponseWriter, r *http.Request, req recipeBody) (RecipeInput, bool) {
	if strings.TrimSpace(req.Title) == "" {
		writeError(w, r, http.StatusBadRequest, "title is required")
		return RecipeInput{}, false
	}
	if !validServings(w, r, req.Servings) {
		return RecipeInput{}, false
	}
	if err := ValidateTags(req.Equipment, req.Methods); err != nil {
		writeErr(w, r, http.StatusBadRequest, "unknown equipment or cooking method", err)
		return RecipeInput{}, false
	}
	cuisine, tags, sourceURL, err := ValidateDiscovery(req.Cuisine, req.TotalMinutes, req.Tags, req.SourceURL)
	if err != nil {
		writeErr(w, r, http.StatusBadRequest, err.Error(), err)
		return RecipeInput{}, false
	}
	return RecipeInput{
		Title:        req.Title,
		Servings:     req.Servings,
		Ingredients:  req.Ingredients,
		Steps:        req.Steps,
		Equipment:    req.Equipment,
		Methods:      req.Methods,
		Cuisine:      cuisine,
		TotalMinutes: req.TotalMinutes,
		Tags:         tags,
		SourceURL:    sourceURL,
	}, true
}

func (h *handlers) createRecipe(w http.ResponseWriter, r *http.Request) {
	var req recipeBody
	if !decodeJSON(w, r, &req) {
		return
	}
	in, ok := validatedInput(w, r, req)
	if !ok {
		return
	}
	// Validated before the recipe is written: a rejected task must not leave a
	// half-created recipe behind.
	//
	// Create is the one write that accepts model-derived tasks, because saving
	// a freshly imported recipe is the only moment they exist: the import
	// preview is returned to the caller and persisted by it, so the tags the
	// model produced come back in this payload or not at all. Update takes
	// manual tasks only — see there.
	prep, err := NormalizePrepTasksBySource(req.PrepTasks, PrepSourceManual, PrepSourceLLM)
	if err != nil {
		writeErr(w, r, http.StatusBadRequest, "invalid prep task", err)
		return
	}
	rec, err := h.store.CreateRecipe(r.Context(), userIDFrom(r.Context()), in)
	if err != nil {
		writeErr(w, r, http.StatusInternalServerError, "could not create recipe", err)
		return
	}
	if !h.savePrep(w, r, &rec, req.PrepTasks, prep, PrepSourceManual, PrepSourceLLM) {
		return
	}
	writeJSON(w, http.StatusCreated, rec)
}

func (h *handlers) listRecipes(w http.ResponseWriter, r *http.Request) {
	recs, err := h.store.ListRecipes(r.Context(), userIDFrom(r.Context()))
	if err != nil {
		writeErr(w, r, http.StatusInternalServerError, "could not list recipes", err)
		return
	}
	writeJSON(w, http.StatusOK, recs)
}

func (h *handlers) listCatalog(w http.ResponseWriter, r *http.Request) {
	recs, err := h.store.ListRecipes(r.Context(), CatalogUserID)
	if err != nil {
		writeErr(w, r, http.StatusInternalServerError, "could not list catalog", err)
		return
	}
	writeJSON(w, http.StatusOK, recs)
}

// addFromCatalog clones a shared catalog recipe into the caller's own recipes
// (UX plan decision #6: clone, don't reference). Cloning rather than pointing at
// the catalog row is what lets a user edit their copy — swap the butter, halve
// the garlic — without mutating a recipe everyone else sees, and keeps their
// copy working when a catalog entry is later retired from catalog.json.
//
// The read is scoped to CatalogUserID, NOT to the caller. Catalog recipes are
// ordinary rows owned by a sentinel user, so looking one up with the caller's id
// silently returns "not found" for every recipe in the catalog — the exact
// mistake that once produced an empty grocery list.
//
// Idempotent: a second call returns the clone the caller already has (200)
// instead of making another (201), so the catalog's add button is safe to
// double-click and safe to press again next week.
func (h *handlers) addFromCatalog(w http.ResponseWriter, r *http.Request) {
	userID := userIDFrom(r.Context())
	if userID == CatalogUserID {
		writeError(w, r, http.StatusBadRequest, "the catalog cannot clone into itself")
		return
	}
	sourceID := r.PathValue("id")

	if existing, err := h.store.FindCloneOf(r.Context(), userID, sourceID); err == nil {
		writeJSON(w, http.StatusOK, existing)
		return
	} else if !errors.Is(err, ErrNotFound) {
		writeErr(w, r, http.StatusInternalServerError, "could not look up an existing copy", err)
		return
	}

	source, err := h.store.GetRecipe(r.Context(), sourceID, CatalogUserID)
	if errors.Is(err, ErrNotFound) {
		writeError(w, r, http.StatusNotFound, "catalog recipe not found")
		return
	}
	if err != nil {
		writeErr(w, r, http.StatusInternalServerError, "could not read the catalog recipe", err)
		return
	}

	in := inputFrom(source)
	in.SourceRecipeID = source.ID
	clone, err := h.store.CreateRecipe(r.Context(), userID, in)
	if err != nil {
		writeErr(w, r, http.StatusInternalServerError, "could not copy the catalog recipe", err)
		return
	}
	writeJSON(w, http.StatusCreated, clone)
}

// listEquipment serves the curated hardware catalog so clients can render
// equipment names and offer a picker without duplicating the dataset. It is
// reference data — the same for every caller — but stays behind the service
// secret like every other route.
func (h *handlers) listEquipment(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, EquipmentList())
}

func (h *handlers) getRecipe(w http.ResponseWriter, r *http.Request) {
	rec, err := h.store.GetRecipe(r.Context(), r.PathValue("id"), userIDFrom(r.Context()))
	if errors.Is(err, ErrNotFound) {
		writeError(w, r, http.StatusNotFound, "recipe not found")
		return
	}
	if err != nil {
		writeErr(w, r, http.StatusInternalServerError, "could not get recipe", err)
		return
	}
	writeJSON(w, http.StatusOK, rec)
}

func (h *handlers) deleteRecipe(w http.ResponseWriter, r *http.Request) {
	err := h.store.DeleteRecipe(r.Context(), r.PathValue("id"), userIDFrom(r.Context()))
	if errors.Is(err, ErrNotFound) {
		writeError(w, r, http.StatusNotFound, "recipe not found")
		return
	}
	if err != nil {
		writeErr(w, r, http.StatusInternalServerError, "could not delete recipe", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// updateRecipe replaces the whole recipe, so an absent field clears the stored
// value rather than leaving it in place — callers echo back what they keep.
func (h *handlers) updateRecipe(w http.ResponseWriter, r *http.Request) {
	var req recipeBody
	if !decodeJSON(w, r, &req) {
		return
	}
	in, ok := validatedInput(w, r, req)
	if !ok {
		return
	}
	// Manual only. An edit is the long-lived write path, and letting it stamp a
	// task "llm" would let a client claim the app guessed something the user
	// wrote. Overriding a model-derived task needs no such claim: reuse its key
	// and precedence does the rest.
	prep, err := NormalizePrepTasksBySource(req.PrepTasks, PrepSourceManual)
	if err != nil {
		writeErr(w, r, http.StatusBadRequest, "invalid prep task", err)
		return
	}
	rec, err := h.store.UpdateRecipe(r.Context(), r.PathValue("id"), userIDFrom(r.Context()), in)
	if errors.Is(err, ErrNotFound) {
		writeError(w, r, http.StatusNotFound, "recipe not found")
		return
	}
	if err != nil {
		writeErr(w, r, http.StatusInternalServerError, "could not update recipe", err)
		return
	}
	if !h.savePrep(w, r, &rec, req.PrepTasks, prep, PrepSourceManual) {
		return
	}
	writeJSON(w, http.StatusOK, rec)
}

// savePrep persists the prep a recipe write carried and folds it into the
// response, so the client gets back the keys the server assigned instead of
// having to guess them.
//
// requested is the raw field: nil (absent or JSON null) means the client said
// nothing about prep and every stored row is left exactly as it is. Otherwise
// each producer in `sources` is replaced — including with nothing, since
// deleting the last task you wrote has to be possible. Producers not listed are
// never touched by this write.
//
// Reports whether the caller should keep writing the response.
func (h *handlers) savePrep(w http.ResponseWriter, r *http.Request, rec *Recipe, requested []StoredPrepTask, normalized map[string][]StoredPrepTask, sources ...string) bool {
	if requested == nil {
		return true
	}
	for _, source := range sources {
		if err := h.store.ReplacePrepTasks(r.Context(), rec.ID, source, normalized[source]); err != nil {
			writeErr(w, r, http.StatusInternalServerError, "could not save prep tasks", err)
			return false
		}
		rec.PrepTasks = replacePrepSource(rec.PrepTasks, source, normalized[source])
	}
	rec.PrepTasks = normPrepTasks(rec.PrepTasks)
	return true
}

func (h *handlers) importRecipe(w http.ResponseWriter, r *http.Request) {
	if h.importer == nil {
		writeError(w, r, http.StatusServiceUnavailable, "import is not configured")
		return
	}
	var req struct {
		URL string `json:"url"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	if strings.TrimSpace(req.URL) == "" {
		writeError(w, r, http.StatusBadRequest, "url is required")
		return
	}
	rec, err := h.importer.Import(r.Context(), userIDFrom(r.Context()), req.URL)
	switch {
	case errors.Is(err, ErrImportBadURL):
		writeError(w, r, http.StatusBadRequest, "invalid or disallowed url")
	case errors.Is(err, ErrImportFetch):
		writeErr(w, r, http.StatusBadGateway, "could not fetch the url", err)
	case errors.Is(err, ErrImportUnparseable):
		writeErr(w, r, http.StatusUnprocessableEntity, "could not extract a recipe from this page; enter it manually", err)
	case err != nil:
		writeErr(w, r, http.StatusInternalServerError, "could not import recipe", err)
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
	for _, it := range req.Items {
		ids = append(ids, it.RecipeID)
	}
	// Catalog recipes are owned by CatalogUserID, not the caller, but the catalog
	// UI lets anyone add them to their basket — readableRecipes resolves both
	// scopes, without which a basket of catalog recipes aggregates to an empty
	// list. The nutrition rollup reads the same helper, so the two paths can
	// never disagree about which recipes a plan contains.
	byID, err := h.readableRecipes(r.Context(), ids)
	if err != nil {
		writeErr(w, r, http.StatusInternalServerError, "could not load recipes", err)
		return
	}

	entries := make([]ScaledRecipe, 0, len(req.Items))
	skipped := make([]string, 0)
	for _, it := range req.Items {
		if rec, ok := byID[it.RecipeID]; ok {
			entries = append(entries, ScaledRecipe{Recipe: rec, Multiplier: it.Multiplier})
		} else {
			skipped = append(skipped, it.RecipeID)
		}
	}
	// An unresolvable id is not fatal (a basket can outlive a deleted recipe),
	// but silently dropping it is how an empty list hides a real bug.
	if len(skipped) > 0 {
		slog.WarnContext(r.Context(), "grocery-list: skipped unresolvable recipe ids",
			"count", len(skipped), "ids", skipped)
	}
	writeJSON(w, http.StatusOK, AggregateScaled(entries))
}

// normalizationLookup exposes the shelf-life/aisle table to Convex, which
// cannot hold a copy of it: canonicalization (synonyms, plural folding) lives
// here, and a duplicated table would drift the moment either side is edited.
// Input is raw ingredient text, so callers get canonicalization for free.
func (h *handlers) normalizationLookup(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Items []string `json:"items"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	seen := make(map[string]bool, len(req.Items))
	out := make([]ItemDetails, 0, len(req.Items))
	for _, raw := range req.Items {
		d := normalizer.Details(raw)
		if d.CanonicalItem == "" || seen[d.CanonicalItem] {
			continue
		}
		seen[d.CanonicalItem] = true
		out = append(out, d)
	}
	writeJSON(w, http.StatusOK, map[string][]ItemDetails{"items": out})
}

// normalizationAvoid resolves free-typed avoid-list entries to what they will
// actually match, so Convex can canonicalize them BEFORE storing (BL-0052).
//
// It is separate from /normalization/lookup for a reason that matters here and
// nowhere else: lookup collapses duplicate results, so a caller cannot tell what
// any individual entry became — and "what did MY entry become, and does it match
// anything at all?" is the entire question an avoid list needs answered. This
// endpoint therefore answers one-to-one and in order, including for entries the
// dictionary does not recognize.
func (h *handlers) normalizationAvoid(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Entries []string `json:"entries"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	out := make([]AvoidResolution, 0, len(req.Entries))
	for _, raw := range req.Entries {
		if res, ok := normalizer.ResolveAvoid(raw); ok {
			out = append(out, res)
		}
	}
	writeJSON(w, http.StatusOK, map[string][]AvoidResolution{"entries": out})
}

// normalizationCoverage reports how much of the ingredient text in real stored
// recipes resolves to a canonical item, and names what did not.
//
// This is the operator surface BL-0031 asks for: an unresolved ingredient never
// errors, it just quietly cannot join to anything, so the only way the
// dictionary grows from real usage instead of guesswork is to be able to LOOK at
// the misses. It reports over the caller's own recipes plus the shared catalog —
// the same corpus the recommender ranks — so the number answers "how well does
// the dictionary serve THIS user", which is the question that matters.
func (h *handlers) normalizationCoverage(w http.ResponseWriter, r *http.Request) {
	mine, err := h.store.ListRecipes(r.Context(), userIDFrom(r.Context()))
	if err != nil {
		writeErr(w, r, http.StatusInternalServerError, "could not list recipes", err)
		return
	}
	catalog, err := h.store.ListRecipes(r.Context(), CatalogUserID)
	if err != nil {
		writeErr(w, r, http.StatusInternalServerError, "could not list catalog", err)
		return
	}
	c := NewCoverageCounter()
	for _, rec := range mine {
		c.AddRecipe(rec)
	}
	for _, rec := range catalog {
		c.AddRecipe(rec)
	}
	writeJSON(w, http.StatusOK, c.Report())
}

// equipmentMatch answers "can I make this?" for a whole recipe library at once.
//
// Inventory lives in Convex — it is reactive user state like the basket — and
// the recipe tags live here, so the owned slugs arrive in the request body and
// the join happens where the recipe data already is. That is the same split
// POST /grocery-list and POST /recommendations/pantry use.
//
// Like the recommender it searches the caller's recipes plus the shared catalog: a
// new user owns no recipes, and an empty screen is not an answer.
//
// Note what this deliberately does NOT do: it never drops a recipe from the
// classification. Blocked recipes come back flagged, and untagged ones come back
// `unknown`, because BL-0043 flags and filters rather than hides — borrowing a
// friend's smoker is a normal thing to do.
func (h *handlers) equipmentMatch(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Owned []string `json:"owned"`
		// Acquired turns this into the new-device query. Its members must also
		// appear in Owned — you cannot be unlocked by hardware you don't have.
		Acquired []string `json:"acquired"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}

	userID := userIDFrom(r.Context())
	recs, err := h.store.ListRecipes(r.Context(), userID)
	if err != nil {
		writeErr(w, r, http.StatusInternalServerError, "could not list recipes", err)
		return
	}
	if userID != CatalogUserID {
		catRecs, err := h.store.ListRecipes(r.Context(), CatalogUserID)
		if err != nil {
			writeErr(w, r, http.StatusInternalServerError, "could not list catalog", err)
			return
		}
		recs = append(recs, catRecs...)
	}

	writeJSON(w, http.StatusOK, MatchRecipes(recs, req.Owned, req.Acquired))
}

// validServings rejects a serving count that cannot be a real yield. nil is
// always valid — it is how a caller says "unknown" — but a stored 0 or a
// negative would silently divide or invert every per-serving figure downstream.
func validServings(w http.ResponseWriter, r *http.Request, servings *int) bool {
	if servings == nil {
		return true
	}
	if *servings < 1 || *servings > maxServings {
		writeError(w, r, http.StatusBadRequest,
			fmt.Sprintf("servings must be between 1 and %d, or omitted", maxServings))
		return false
	}
	return true
}

// decodeJSON reads a JSON request body with a size cap. It writes an error
// response and returns false if the body is too large (413) or malformed (400).
func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	if err := json.NewDecoder(r.Body).Decode(dst); err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			writeError(w, r, http.StatusRequestEntityTooLarge, "request body too large")
			return false
		}
		writeError(w, r, http.StatusBadRequest, "invalid JSON body")
		return false
	}
	return true
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// writeError responds with a JSON error and records it. 5xx marks the span as
// failed so Tempo surfaces it; 4xx logs at warn level because it is usually a
// client mistake, not our bug.
func writeError(w http.ResponseWriter, r *http.Request, status int, msg string) {
	writeErr(w, r, status, msg, nil)
}

// writeErr is writeError plus the underlying cause. Use it wherever an error
// value is in scope — before BL-0027 those causes were discarded entirely.
func writeErr(w http.ResponseWriter, r *http.Request, status int, msg string, cause error) {
	ctx := r.Context()

	attrs := []any{"status", status, "path", r.URL.Path, "method", r.Method}
	if cause != nil {
		attrs = append(attrs, "err", cause)
	}

	if status >= http.StatusInternalServerError {
		span := trace.SpanFromContext(ctx)
		span.SetStatus(codes.Error, msg)
		if cause != nil {
			span.RecordError(cause)
		} else {
			span.RecordError(errors.New(msg))
		}
		slog.ErrorContext(ctx, msg, attrs...)
	} else {
		slog.WarnContext(ctx, msg, attrs...)
	}

	writeJSON(w, status, map[string]string{"error": msg})
}
