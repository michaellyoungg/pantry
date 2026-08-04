package recipe

import "time"

// CatalogUserID owns the shared, system-curated recipe catalog (BL-0002).
// Catalog recipes are ordinary recipes rows with this user_id.
const CatalogUserID = "catalog"

type Ingredient struct {
	Quantity float64 `json:"quantity"`
	Unit     string  `json:"unit"`
	Item     string  `json:"item"`
	Note     string  `json:"note,omitempty"`
}

type Recipe struct {
	ID     string `json:"id"`
	UserID string `json:"userId"`
	Title  string `json:"title"`
	// Servings is how many people the recipe feeds, or nil when unknown —
	// existing recipes and manual entry without a yield both leave it unset.
	// It is an absolute count, unlike the planner's servingsMultiplier, which
	// is a scale factor on a basket entry. Consumers must omit per-serving
	// figures when it is nil rather than assume a default (BL-0035).
	Servings    *int         `json:"servings,omitempty"`
	Ingredients []Ingredient `json:"ingredients"`
	// Steps are the ordered instruction lines (the method). May be empty; recipes
	// imported before steps were persisted, or entered ingredients-only, have none.
	Steps []string `json:"steps"`
	// Equipment references the curated catalog by slug (BL-0041). May be empty:
	// recipes entered by hand and imports whose steps mention no known hardware
	// carry no tags.
	Equipment []RecipeEquipment `json:"equipment"`
	// Methods are members of the closed cooking-method enum. Closed because
	// BL-0042's prep rules key on them.
	Methods []string `json:"methods"`
	// ── Discovery metadata (BL-0020) ────────────────────────────────────────
	// Cuisine is a normalized slug ("italian"), or "" when unknown. An OPEN
	// vocabulary — see discovery.go for why it is not an enum like Methods.
	Cuisine string `json:"cuisine,omitempty"`
	// TotalMinutes is wall-clock time from starting to eating, or nil when
	// unknown. Nil is not zero: a recipe with no stated time must not sort or
	// filter as instant. This is the catalog's #1 weeknight filter.
	TotalMinutes *int `json:"totalMinutes,omitempty"`
	// Tags are normalized free-form slugs ("vegan", "one-pot"). Always non-nil.
	// Diet is expressed here rather than as its own field: the UI groups the
	// tags it recognizes as diets into a chip row, and an unrecognized tag is
	// still searchable instead of being dropped.
	Tags []string `json:"tags"`
	// SourceURL is where the recipe came from, for attribution and re-import.
	// "" for hand-entered recipes. Always an absolute http(s) URL when set.
	SourceURL string `json:"sourceUrl,omitempty"`
	// SourceRecipeID is the catalog recipe this one was cloned from, or "".
	//
	// Server-owned provenance, never accepted from a client: it is what makes
	// "add this catalog recipe" idempotent, so a second click returns the copy
	// the user already has instead of silently making another one. Set once at
	// clone time and immutable afterwards — see UpdateRecipe, which deliberately
	// does not write this column even though it replaces everything else.
	SourceRecipeID string `json:"sourceRecipeId,omitempty"`
	// PrepTasks are the prep tasks that cannot be re-derived: hand-authored and
	// model-derived (BL-0044). Rule-derived prep is absent here on purpose — it
	// is computed on read by DerivePrepTasks and merged with these, precedence
	// manual > llm > rule. Usually empty.
	//
	// Deliberately NOT part of RecipeInput: the two producers write it
	// independently through ReplacePrepTasks, so it is not replaced wholesale
	// by a recipe write the way every field above is.
	PrepTasks []StoredPrepTask `json:"prepTasks"`
	CreatedAt time.Time        `json:"createdAt"`
}

// RecipeInput is everything a client can set on a recipe. It exists because
// create and update took eight positional arguments before discovery metadata
// and would take twelve after — a call site no reviewer can check. Every field
// is replaced wholesale on update, so an omitted one CLEARS the stored value
// rather than leaving it in place (the contract servings established in
// BL-0035); callers echo back what they want to keep.
// The one exception is SourceRecipeID, which is set on create and then frozen;
// it is provenance the server owns, not a field the user is editing.
type RecipeInput struct {
	Title          string
	Servings       *int
	Ingredients    []Ingredient
	Steps          []string
	Equipment      []RecipeEquipment
	Methods        []string
	Cuisine        string
	TotalMinutes   *int
	Tags           []string
	SourceURL      string
	SourceRecipeID string
}

// inputFrom projects a stored recipe back into the input that would recreate
// it. It is what makes clone-on-add a two-line operation, and it must stay
// exhaustive: a field added to Recipe but not copied here is silently dropped
// by every clone.
func inputFrom(rec Recipe) RecipeInput {
	return RecipeInput{
		Title:        rec.Title,
		Servings:     copyIntPtr(rec.Servings),
		Ingredients:  rec.Ingredients,
		Steps:        rec.Steps,
		Equipment:    rec.Equipment,
		Methods:      rec.Methods,
		Cuisine:      rec.Cuisine,
		TotalMinutes: copyIntPtr(rec.TotalMinutes),
		Tags:         rec.Tags,
		SourceURL:    rec.SourceURL,
		// Not SourceRecipeID: cloning a clone is still a clone OF THE CATALOG
		// ENTRY, and copying the field blindly here would be how a user's own
		// recipe inherits provenance it does not have. cloneOf sets it.
	}
}

type GroceryLine struct {
	Item string `json:"item"`
	// CanonicalItem is the normalized ingredient key (lowercased, synonyms
	// resolved) that Item's display string was derived from. It is the identity
	// the pantry is keyed on — Item is for humans, CanonicalItem is for joins.
	CanonicalItem string  `json:"canonicalItem"`
	Unit          string  `json:"unit"`
	Quantity      float64 `json:"quantity"`
	Aisle         string  `json:"aisle"`
	// Sources are the recipes this line was aggregated from, in first-seen
	// order. Nil when nothing traceable contributed (see GroceryLineSource).
	Sources []GroceryLineSource `json:"sources,omitempty"`
}

// GroceryLineSource is one recipe's contribution to an aggregated grocery line:
// which recipe, and how much of the line's total came from it.
//
// Quantity is expressed in the *line's* unit, not the unit the recipe wrote, so
// the contributions visibly add up to the number the shopper is looking at
// ("why is this 3/4 cup?" -> "1/4 from Cookies, 1/2 from Toast"). That is the
// question the provenance sheet exists to answer, so additivity beats fidelity
// to the original wording. The unit is therefore not repeated here — it is
// always the parent line's.
type GroceryLineSource struct {
	RecipeID string  `json:"recipeId"`
	Title    string  `json:"title"`
	Quantity float64 `json:"quantity"`
}
