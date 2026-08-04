export interface Ingredient {
  quantity: number;
  unit: string;
  item: string;
  note?: string;
}

/**
 * The closed cooking-method enum (BL-0041). Closed on purpose: BL-0042's prep
 * rules key on these values, and rules cannot be written against a vocabulary
 * that varies per recipe. recipe-service is the source of truth
 * (`internal/recipe/equipment.json`); this union mirrors it.
 *
 * Deliberately a type and not a runtime array. This package ships as `dist`
 * only, and nothing else in the repo imports a VALUE from it: the Convex
 * bundler and the Vite dev server both resolve it without a build step only
 * while every import is `import type`. Consumers that need the members at
 * runtime declare their own list and prove it covers this union at compile
 * time — see packages/convex/convex/recipes.ts and
 * apps/web/src/lib/cookingMethods.ts.
 */
export type CookingMethod =
  | "bake"
  | "roast"
  | "grill"
  | "smoke"
  | "sous_vide"
  | "slow_cook"
  | "pressure_cook"
  | "fry"
  | "saute"
  | "boil"
  | "marinate"
  | "no_cook";

export type EquipmentCategory = "appliance" | "cookware" | "tool";

/** One entry of the curated hardware catalog served by GET /equipment. */
export interface EquipmentDef {
  id: string;
  name: string;
  category: EquipmentCategory;
  aliases: string[];
}

/**
 * An equipment tag on a recipe, referencing the catalog by slug.
 * `required: false` is "a grill pan works too" — optional gear must not block
 * BL-0043's "can I make this?" check.
 */
export interface RecipeEquipment {
  id: string;
  required: boolean;
}

export interface Recipe {
  id: string;
  userId: string;
  title: string;
  /**
   * How many people the recipe feeds. Absent means the yield is unknown —
   * existing recipes and manual entry without a yield both leave it unset, so
   * consumers must omit per-serving figures rather than assume a default.
   *
   * This is an absolute count. It is not the planner's `servingsMultiplier`,
   * which is a scale factor ("cook 1.5x this recipe") on a basket entry.
   */
  servings?: number;
  ingredients: Ingredient[];
  /** Ordered instruction lines (the method). Empty for ingredients-only recipes. */
  steps: string[];
  /** Equipment tags referencing the catalog. Empty when nothing was detected. */
  equipment: RecipeEquipment[];
  /** Members of the closed method enum. Empty when nothing was detected. */
  methods: CookingMethod[];
  /**
   * Discovery metadata (BL-0020) — what the catalog's filter chips read.
   *
   * `cuisine` and `tags` are an OPEN vocabulary, deliberately unlike
   * `methods`. Methods are closed because BL-0042's prep rules key on them;
   * nothing keys on a cuisine or a tag, so an import that meets a cuisine we
   * have never heard of should keep it rather than drop it. recipe-service
   * normalizes both to slugs, so "Gluten Free" and "gluten_free" are one chip.
   *
   * Absent when unknown.
   */
  cuisine?: string;
  /**
   * Wall-clock minutes from starting to eating. Absent means unknown — never
   * zero, and never sorted or filtered as if it were fast. This is the #1
   * weeknight filter.
   */
  totalMinutes?: number;
  /**
   * Free-form slugs ("vegan", "one-pot"). Diet lives here rather than in its
   * own field: the UI groups the tags it recognizes as diets into a chip row,
   * and a tag it does not recognize stays searchable instead of being dropped.
   */
  tags: string[];
  /** Where the recipe came from, for attribution and re-import. Absent when hand-entered. */
  sourceUrl?: string;
  /**
   * The catalog recipe this one was cloned from (BL-0020's clone-on-add).
   *
   * Server-owned and read-only: it is the idempotency key that stops a second
   * "Add to basket" from making a second copy, so a client cannot set it.
   * Present only on recipes that came from the catalog.
   */
  sourceRecipeId?: string;
  /**
   * Prep tasks stored on the recipe: hand-authored and model-derived (BL-0044).
   * Rule-derived prep is absent here — it is computed on read from the rule
   * table and merged with these, precedence `manual > llm > rule`. Usually
   * empty.
   */
  prepTasks: StoredPrepTask[];
  createdAt: string; // ISO-8601
}

/**
 * Whether a recipe's hardware requirements are met by an equipment inventory
 * (BL-0043).
 *
 * `unknown` is the important one: a recipe carrying no equipment tags has never
 * been assessed, and presenting that as `makeable` would turn missing data into
 * a green light. UI must render it as "we don't know", never as a yes.
 */
export type EquipmentFitStatus = "makeable" | "blocked" | "unknown";

/**
 * How one recipe fares against an inventory, without the recipe body — the
 * compact shape the catalog joins onto recipes it already has.
 */
export interface EquipmentFit {
  status: EquipmentFitStatus;
  /** Required equipment slugs the user lacks. Empty unless status is "blocked". */
  missing: string[];
  /** Which newly acquired devices this recipe needed. Only set by a discovery query. */
  unlockedBy: string[];
}

/** A recipe plus its fit — the shape POST /equipment/match returns. */
export type EquipmentMatch = Recipe & EquipmentFit;

/**
 * Bucket sizes over every recipe considered — including recipes the narrowed
 * list omits, so "N we can't assess" keeps an honest denominator.
 */
export interface EquipmentCounts {
  makeable: number;
  blocked: number;
  unknown: number;
}

export interface EquipmentMatchResult {
  recipes: EquipmentMatch[];
  counts: EquipmentCounts;
}

/**
 * One recipe's contribution to an aggregated grocery line.
 *
 * `quantity` is in the *parent line's* unit, not the unit the recipe wrote, so
 * the contributions add up to the line total — that additivity is the question
 * the provenance sheet answers ("why is this ¾ cup?"). The unit is therefore
 * not repeated here.
 */
export interface GroceryLineSource {
  recipeId: string;
  title: string;
  quantity: number;
}

export interface GroceryLine {
  item: string;
  /** Normalized ingredient key ("green onion"); the identity the pantry joins on. */
  canonicalItem: string;
  unit: string;
  quantity: number;
  aisle: string;
  /**
   * The recipes this line was aggregated from, in first-seen order. Absent for
   * manually added lines and for lines generated before BL-0019.
   */
  sources?: GroceryLineSource[];
}

/**
 * The write shape for a recipe. Update accepts exactly the same fields and
 * replaces the recipe wholesale, so an omitted field CLEARS the stored value —
 * callers echo back whatever they want to keep. `sourceRecipeId` is absent by
 * design: it is server-owned provenance, not something a client sets.
 */
export interface CreateRecipeRequest {
  title: string;
  /** Omit when unknown; recipe-service rejects a value outside 1..100. */
  servings?: number;
  ingredients: Ingredient[];
  steps?: string[];
  equipment?: RecipeEquipment[];
  methods?: CookingMethod[];
  /** Free text; recipe-service slugifies it. Omit when unknown. */
  cuisine?: string;
  /** Omit when unknown. recipe-service rejects zero and negatives. */
  totalMinutes?: number;
  tags?: string[];
  /** Must be an absolute http(s) URL; anything else is rejected. */
  sourceUrl?: string;
}

export interface GroceryListItem {
  recipeId: string;
  multiplier: number;
}

export interface GroceryListRequest {
  items: GroceryListItem[];
}

export interface ImportRecipeRequest {
  url: string;
}

/**
 * One nutrient amount, keyed by FDC nutrient number ("1008" energy kcal, "1003"
 * protein, "1253" cholesterol). We use FDC's numbering rather than inventing a
 * parallel taxonomy.
 */
export interface NutrientAmount {
  nutrientId: string;
  amount: number;
  unit: string;
}

/** How much of a recipe the estimate actually accounts for. Never optional. */
export interface NutritionCoverage {
  /** 0..1 of the recipe's mass that resolved to a food with nutrient data. */
  resolvedMassFraction: number;
  resolvedCount: number;
  totalCount: number;
}

/** Per-ingredient provenance: what we made of each line, and why we failed. */
export interface NutritionIngredient {
  item: string;
  /** null when the line's mass could not be determined. */
  grams: number | null;
  /** True only if the line contributed nutrients — mass known AND food matched. */
  resolved: boolean;
  /** Why the line is unresolved, e.g. `no gram weight for unit "pinch"`. */
  reason?: string;
  /** How the grams were derived: mass | portion | density | count. */
  method?: string;
  /** The FDC description matched, so a wrong fuzzy match is visible. */
  matchedFood?: string;
}

/**
 * One recipe's contribution to a multi-recipe rollup (BL-0037).
 *
 * A single blended `resolvedMassFraction` cannot express every way a rollup is
 * incomplete: it describes the food it *saw*. A recipe that could not be loaded
 * at all contributes to neither side of that ratio, so a day missing a whole
 * dinner would otherwise read as fully covered. `counted` is that case, named.
 */
export interface NutritionRecipeCoverage {
  recipeId: string;
  /** Absent when the recipe could not be read — an unreadable recipe leaks nothing. */
  title?: string;
  /** The servings dial this recipe contributed at. */
  multiplier: number;
  /** False when the recipe's ingredients never reached the totals at all. */
  counted: boolean;
  /** This recipe's own coverage, so the one bad dish can be named. */
  coverage: NutritionCoverage;
}

/**
 * An estimated nutrient vector for a recipe or a selection of recipes.
 *
 * `nutrients` is an open map on purpose — adding a nutrient must be a data
 * change, never a wire-type change across three languages. Do not narrow it to
 * a typed macro struct.
 */
export interface NutritionEstimate {
  nutrients: Record<string, NutrientAmount>;
  /** Absent when the recipe's yield is unknown; never divided by a guess. */
  perServing?: Record<string, NutrientAmount>;
  servings: number;
  coverage: NutritionCoverage;
  ingredients: NutritionIngredient[];
  estimatedAt: string; // ISO-8601
  /**
   * Present only on a rollup (`POST /nutrition/estimate`), where "which dish is
   * missing?" is a question the blended coverage figure cannot answer.
   */
  recipes?: NutritionRecipeCoverage[];
}

/**
 * Grocery pricing (BL-0023 increment 1).
 *
 * Deliberately a separate contract from GroceryLine rather than fields on it:
 * price data has its own source, refresh cadence and legal constraints, and the
 * grocery list must keep working when pricing is unavailable.
 */

/** How stale the underlying price table is, graded when the estimate is made. */
export type PriceStaleness = "fresh" | "aging" | "stale";

/** Provenance for an estimate. A total shown without this is a number pretending to be a price. */
export interface PriceBasis {
  source: string;
  sourceUrl: string;
  /** Geographic basis of the averages, e.g. "U.S. city average". */
  area: string;
  /** "YYYY-MM" the prices were observed. */
  observationMonth: string;
  staleness: PriceStaleness;
}

/** Per-line outcome. Unpriced lines carry a reason and contribute nothing to the total. */
export interface PricedLine {
  canonicalItem: string;
  item: string;
  priced: boolean;
  cents?: number;
  /** Which coarse price bucket the ingredient resolved to. */
  bucket?: string;
  bucketLabel?: string;
  /** Why the line could not be priced, when `priced` is false. */
  reason?: string;
}

export interface CostEstimate {
  currency: string;
  totalCents: number;
  pricedCount: number;
  unpricedCount: number;
  lines: PricedLine[];
  basis: PriceBasis;
}

/** One pantry row as the recommender sees it. Mirrors Go recommend.PantryItem. */
export interface PantryContextItem {
  canonicalItem: string;
  state: "have" | "low" | "out";
  useItUp?: boolean;
  /**
   * Approximate spoil date, epoch ms (BL-0029). Absent when the shelf-life table
   * doesn't recognize the item — which is not the same as "keeps forever", and
   * is why the ranker treats absence as no signal rather than as a far-off date.
   */
  useBy?: number;
}

/** Ingredient-grounded preferences. `avoidItems` is a hard filter, not a weight. */
export interface RecommendationPreferences {
  avoidItems: string[];
  likedItems: string[];
  dislikedItems: string[];
}

/**
 * What one avoid-list entry turned out to be (BL-0052).
 *
 * - `item` — one canonical ingredient.
 * - `allergen` — a whole family, which excludes every one of its `members`.
 * - `unknown` — the dictionary has never seen this text, so the entry will
 *   remove no recipe. That case is the reason this type exists: an avoid entry
 *   that silently matches nothing is the bug, and for a declared allergy it is
 *   not a cosmetic one.
 *
 * Mirrors Go recipe.AvoidResolution, the wire shape of POST /normalization/avoid.
 */
export type AvoidResolutionKind = "item" | "allergen" | "unknown";

export interface AvoidResolution {
  /** The text the user actually typed, so a client can say "scallion → green onion". */
  input: string;
  /** What gets STORED: a canonical item key, a family key, or the normalized text. */
  canonicalItem: string;
  display: string;
  kind: AvoidResolutionKind;
  /** Display names of everything an allergen family excludes. `allergen` only. */
  members?: string[];
  /** Families a single item belongs to — a nudge toward the broader entry. `item` only. */
  families?: string[];
}

/**
 * One nutrition goal as the recommender sees it (BL-0040). Mirrors Go
 * recommend.NutritionTarget — the stored `nutritionTargets` row minus `active`,
 * because only active goals are ever sent.
 */
export interface RecommendationNutritionTarget {
  nutrientId: string;
  operator: NutritionTargetOperator;
  value: number;
  period: NutritionTargetPeriod;
  label?: string;
  hard?: boolean;
}

/**
 * What the week's plan ALREADY commits, so a `week` target is scored on the gap
 * that remains rather than on the whole goal. Mirrors Go recommend.PlanNutrition.
 */
export interface RecommendationPlanNutrition {
  /** nutrientId -> amount, in the estimate's units. */
  nutrients: Record<string, number>;
  coverage: NutritionCoverage;
}

/** Mirrors Go recommend.UserContext. */
export interface RecommendationRequest {
  pantry: PantryContextItem[];
  preferences: RecommendationPreferences;
  affinities?: Record<string, number>;
  savedRecipeIds?: string[];
  excludeRecipeIds?: string[];
  limit?: number;
  /**
   * Keep candidates that share nothing with the pantry (BL-0033). The "cook what
   * you have" surface drops them as noise; set selection needs them, because a
   * dish can earn its place by sharing ingredients with the other dinners.
   */
  includeUnmatched?: boolean;
  /**
   * The caller's clock, epoch ms. Sent rather than read from the server clock so
   * scoring stays a pure function of its input. Omitting it makes expiry
   * unavailable — absent data degrades to "no signal", never to a guess.
   */
  now?: number;
  /** ACTIVE goals only: a paused goal is not a goal. */
  nutritionTargets?: RecommendationNutritionTarget[];
  planNutrition?: RecommendationPlanNutrition | null;
}

export interface RecommendationMissingItem {
  canonicalItem: string;
  display: string;
  /**
   * A keep-on-hand ingredient — salt, oil, the spice rack (BL-0031).
   *
   * It lets a card say "you have everything but the salt" instead of listing
   * salt beside chicken as though they were the same errand. Optional because
   * a client may be reading a response from a service that predates the flag;
   * absent means "not a staple", the conservative reading.
   */
  staple?: boolean;
}

/**
 * A HARD constraint this candidate could not be checked against.
 *
 * It carries the nutrient id rather than a rendered string because only the
 * client has the nutrient catalog to name it with. Its existence is the reason
 * an unmeasured recipe can survive a filter without being presented as having
 * passed it.
 */
export interface RecommendationUnverifiedConstraint {
  nutrientId: string;
  label?: string;
}

/**
 * The most-urgent expiring ingredient a recipe would clear (BL-0050).
 *
 * Typed rather than folded into `reasons` so the card can render "use this soon"
 * distinctly from "you'd like this" — they are different kinds of claim, and
 * telling them apart by prefix-matching a reason string would be brittle.
 */
export interface RecommendationUrgency {
  canonicalItem: string;
  display: string;
  /** Epoch ms, so the card formats it with the same helper as its items strip. */
  useBy: number;
}

/** Mirrors Go recommend.Result. */
export interface Recommendation {
  recipeId: string;
  title: string;
  /** "generated" is reserved for a future LLM candidate provider (BL-0034). */
  source: "catalog" | "user" | "generated";
  score: number;
  reasons: string[];
  have: string[];
  missing: RecommendationMissingItem[];
  /** Absent when nothing this recipe uses is expiring within the horizon. */
  urgency?: RecommendationUrgency;
  /**
   * 0..1 for how well this candidate closes the plan's remaining gap, or null
   * when nothing could be measured. Null rather than 0: a data gap is not a bad
   * score, and the two must never look alike.
   */
  nutritionFit?: number | null;
  nutritionUnverified?: RecommendationUnverifiedConstraint[];
}

export interface RecommendationResponse {
  results: Recommendation[];
}

/**
 * Nutrition habit review (BL-0039).
 *
 * `nutritionLog` records what a user ate, one row per recipe per day. Rows are
 * written from the plan as `planned`; when BL-0028 lands, "mark cooked" upgrades
 * the same row to `cooked`. `manual` is reserved for a future food diary.
 */
export type NutritionLogSource = "planned" | "cooked" | "manual";

/**
 * The nutrient vector denormalized at log time — the whole point of the log.
 *
 * FDC data is refreshed and ingredient→food mappings get corrected. Recomputing
 * history from current data would silently rewrite what the user ate last month,
 * so history reads this snapshot and never re-estimates.
 *
 * `nutrients` is the estimate for **one whole recipe yield**; the amount eaten is
 * that vector scaled by the row's `servings` multiplier. Keeping the snapshot
 * unscaled is what lets BL-0028 upgrade a row to `cooked` with a different
 * quantity by changing one number instead of re-estimating.
 */
export interface NutritionLogSnapshot {
  nutrients: Record<string, NutrientAmount>;
  /** Coverage at log time. Without it, an unknown day is indistinguishable from a zero day. */
  coverage: NutritionCoverage;
  estimatedAt: string; // ISO-8601
}

/** One logged meal, as the review surface consumes it. */
export interface NutritionLogEntry {
  date: string; // YYYY-MM-DD
  recipeId: string;
  /** Denormalized for display; the log must stay readable if the recipe is deleted. */
  title?: string;
  /** How many whole recipe yields were eaten. Scales `snapshot.nutrients`. */
  servings: number;
  source: NutritionLogSource;
  snapshot: NutritionLogSnapshot;
}

/**
 * Nutrition targets (BL-0038).
 *
 * A goal is a *constraint*, never a feature. "150 g of protein a day", "keep
 * cholesterol under 200 mg", "stay under 2,000 calories" and "low carb" differ
 * only in their field values, so one row shape and one evaluator serve all of
 * them — and serve goals nobody has asked for yet. There is deliberately no
 * `lowCarbMode` boolean anywhere in the system.
 */
export type NutritionTargetOperator = "<=" | ">=" | "==";

/**
 * The window a target is measured over. `meal` is a single serving of a single
 * recipe, which is what makes a "fits your goals" badge on a recipe possible
 * without inventing a second concept.
 */
export type NutritionTargetPeriod = "day" | "week" | "meal";

/** One constraint. A macro goal is three or four of these; a diet is one or two. */
export interface NutritionTarget {
  nutrientId: string;
  operator: NutritionTargetOperator;
  value: number;
  period: NutritionTargetPeriod;
  /** Optional user- or preset-supplied name, e.g. "Low cholesterol". */
  label?: string;
  /** Inactive targets are kept but never evaluated, so pausing a diet is not a delete. */
  active: boolean;
  /**
   * Marks this goal as a HARD constraint (BL-0040): recommendations REMOVE
   * candidates that break it instead of merely ranking them lower.
   *
   * The operator cannot express this. `<= 200 mg cholesterol` is a preference
   * for one person and a medical limit for another, and only they know which —
   * so the distinction is a flag the user sets, never an inference we make.
   */
  hard?: boolean;
}

/**
 * `unknown` is not a failure mode, it is the honest answer when coverage is too
 * low to say. It must never collapse to `met`: a missing ingredient reading as
 * "under your limit" turns absent data into false reassurance on a health
 * screen, which is worse than showing nothing.
 */
export type NutritionTargetStatus = "met" | "under" | "over" | "unknown";

/** Why a target could not be evaluated. Present only when status is `unknown`. */
export type NutritionUnknownReason =
  /** No estimate at all — nothing planned, or the rollup has not loaded. */
  | "no-estimate"
  /** Too little of the food resolved for the total to mean anything. */
  | "low-coverage"
  /** The estimate resolved, but carries no amount for this nutrient. */
  | "nutrient-missing";

export interface NutritionTargetEvaluation {
  target: NutritionTarget;
  /** The measured amount, or null when the status is `unknown`. */
  actual: number | null;
  /** Unit of `actual`, from the estimate or the nutrient catalog. */
  unit: string | null;
  status: NutritionTargetStatus;
  reason?: NutritionUnknownReason;
  /** 0..1 of the underlying food that resolved, carried through for the UI. */
  coverage: number | null;
}

/**
 * A diet preset is a *bundle of target rows*, shipped as data. Adding "low
 * sodium" is an edit to a data file — no schema change, no evaluator branch, no
 * new code path.
 */
export interface DietPreset {
  id: string;
  label: string;
  description: string;
  targets: Array<Omit<NutritionTarget, "active">>;
}

/**
 * When, relative to the cook date, a piece of prep has to happen (BL-0042).
 *
 * Coarse by design — day granularity, no clock times — because the planner
 * schedules meals onto days and nothing in it knows what time dinner is.
 * Ordered coarsest lead time first, which is also the order tasks are shown in:
 * the three-day thaw is both the most urgent to see and the easiest to miss.
 */
export type PrepWindow =
  | "three_days_before"
  | "two_days_before"
  | "night_before"
  | "morning_of"
  | "hour_before"
  | "at_start";

/**
 * Which producer emitted a task (BL-0044).
 *
 * Three producers, one stream, one precedence order: `manual > llm > rule`,
 * applied per task key. A hand-authored task therefore *replaces* the rule task
 * it shares a key with rather than appearing beside it.
 *
 * - `rule` — derived on read from the versioned rule table. Never stored, so
 *   improving a rule improves every recipe at once.
 * - `llm` — the model matched a rule the deterministic scan missed. The text is
 *   still the rule's; the model chose the match, not the words.
 * - `manual` — the user wrote it.
 */
export type PrepSource = "rule" | "llm" | "manual";

/**
 * A prep task stored on a recipe: the two producers whose output cannot be
 * recomputed. Carries no rule id and no due date — it is not derived, and its
 * due date depends on the meal it is scheduled for.
 */
export interface StoredPrepTask {
  /**
   * The merge identity, shared with {@link PrepTask.key}.
   *
   * A task written to *override* a derived one carries that task's key
   * verbatim; that is how "this rule is wrong for this recipe" is expressed. A
   * task written fresh gets a key from its own text
   * (`manual:take-the-turkey-out`), assigned by the server.
   */
  key: string;
  window: PrepWindow;
  text: string;
  source: PrepSource;
}

/**
 * A prep task on its way *to* the server.
 *
 * `key` is omitted when authoring something new and echoed back verbatim when
 * editing or overriding. `source` is omitted entirely: the server stamps the
 * producer it is writing for, so a client cannot label its own guess as
 * something the user wrote. (Create accepts an explicit `llm` for tasks a fresh
 * import produced, since the import preview is never persisted server-side.)
 */
export interface PrepTaskInput {
  key?: string;
  window: PrepWindow;
  text: string;
  /** Never `rule`: rule-derived prep is computed, never stored. */
  source?: Exclude<PrepSource, "rule">;
}

/** One piece of lead-time work for one meal on one date. */
export interface PrepTask {
  /**
   * Stable across re-derivation: `ruleId:subject`. Check-off is keyed on it, so
   * editing a rule's text preserves the tick and changing a rule's id
   * deliberately does not.
   */
  key: string;
  ruleId: string;
  /** The canonical ingredient, cooking method, or equipment slug the rule matched. */
  subject: string;
  window: PrepWindow;
  text: string;
  source: PrepSource;
  /** ISO date the task is due: the cook date minus the window's lead time. */
  dueOn: string;
  /**
   * The due date has already passed. A missed task is still returned — the
   * whole point of lead time is that forgetting it is the failure worth
   * reporting, not something to hide.
   */
  missed?: boolean;
}

/** Derived prep for one planned meal. */
export interface PrepMeal {
  recipeId: string;
  title: string;
  /** ISO date the meal is planned for. */
  cookDate: string;
  tasks: PrepTask[];
}

/** The POST /prep-tasks response. */
export interface PrepTasksResponse {
  /** Revision of the rule table that produced these tasks, for traceability. */
  rulesVersion: string;
  meals: PrepMeal[];
}
