// @pantry/types — the shapes shared across the TypeScript side of the monorepo.
//
// Most of this package is GENERATED. The recipe-service HTTP contract is
// written once, in `contract/openapi.yaml`, and rendered into
// `contract.generated.ts`; the Go server structs are checked against the same
// spec by `apps/recipe-service/internal/contract` (BL-0007). Editing a wire
// type here would silently un-share it, so edit the spec and run
// `pnpm contract:codegen`.
//
// What stays hand-written below is everything that never crosses that wire:
// the shapes Convex owns end to end. They live here rather than in
// `@pantry/convex` because every client reads them.
//
// A star re-export rather than a named list, because the alternative is a
// sixty-line index that has to be edited every time the spec gains a field —
// exactly the hand-maintained mirror this package exists to retire. `export
// type *` keeps the erase-on-import property the note on `CookingMethod`
// depends on: nothing here is a runtime value.
export type * from "./contract.generated";

import type {
  NutrientAmount,
  NutritionCoverage,
  RecommendationNutritionTarget,
} from "./contract.generated";

/**
 * What a user did with a recommendation (BL-0005 increment 2).
 *
 * `shown` is an impression, and it is deliberately worth NOTHING as a taste
 * signal — the user did not choose to be shown the card. It is recorded because
 * the discovery ranker's `novelty` reads it: "you have seen this six times" is a
 * fact about the UI, not an opinion about the food.
 *
 * `cooked` outweighs `accepted` because planning a meal is an intention and
 * cooking it is a completed act.
 */
export type RecommendationEventAction = "shown" | "accepted" | "dismissed" | "cooked";

/** Which surface an interaction happened on. */
export type RecommendationContext = "pantry" | "discover";

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
 * One constraint. A macro goal is three or four of these; a diet is one or two.
 *
 * The stored row is the wire shape plus `active`: only active goals are sent to
 * the recommender, which is why `RecommendationNutritionTarget` — the generated
 * contract type — is exactly this minus that field.
 */
export interface NutritionTarget extends RecommendationNutritionTarget {
  /** Inactive targets are kept but never evaluated, so pausing a diet is not a delete. */
  active: boolean;
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
  targets: RecommendationNutritionTarget[];
}

/**
 * The word a user types to confirm account deletion (BL-0068).
 *
 * A type, not a runtime constant, for the reason `CookingMethod` is one: this
 * package ships as `dist` only and every import of it must be `import type`.
 * Convex declares the literal (`convex/account.ts`) and each client declares
 * its own; all three prove they match this union at compile time, so the
 * confirmation the UI asks for and the one the server accepts cannot drift.
 */
export type AccountDeletionConfirmation = "DELETE";
