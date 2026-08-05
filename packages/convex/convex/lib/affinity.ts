import type { RecommendationEventAction, RecommendationInteraction } from "@pantry/types";

/**
 * Turning the interaction log into a taste signal (BL-0005 increment 2).
 *
 * This is a PURE function of (events, now) and lives away from any Convex
 * handler so it can be table-tested. That is not just tidiness: the rules below
 * are the entire learned half of the recommender, and every one of them is a
 * judgement about how to read a user's behaviour rather than a mechanism.
 *
 * Three decisions are load-bearing:
 *
 *  - **Derived at request time, never stored as a score.** There is no
 *    per-user per-ingredient table. A stored score is a second source of truth
 *    about the same events, and the day it drifts from them there is no way to
 *    tell which one is wrong. If this fold ever becomes expensive it becomes a
 *    CACHE of these events — a local change with an obvious invalidation — not
 *    a new authority.
 *  - **An empty fold returns an EMPTY map, and the ranker treats that as
 *    UNAVAILABLE rather than as a row of zeroes.** A user who has done nothing
 *    has told us nothing. Sending `{}` and having the ranker score every
 *    candidate at zero on the heaviest-weighted feature would punish precisely
 *    the users who have not used the product yet. See
 *    `internal/recommend/affinity.go`.
 *  - **Saturating, not relative, normalization.** Weights are squashed with
 *    tanh against a fixed scale rather than divided by the largest weight
 *    present. Relative normalization would make the top ingredient score ±1 for
 *    everyone forever — a user with one click and a user with a year of history
 *    would look equally certain — and would rescale every other ingredient every
 *    time a new event arrived.
 */

/**
 * What each kind of interaction says about taste.
 *
 * `shown` is deliberately ZERO. An impression is not an opinion: the user did
 * not choose to be shown the card, and counting it would let the recommender
 * teach itself its own past decisions. Impressions are still recorded, and they
 * are read by the discovery ranker's `novelty` — "you have seen this six times"
 * is a fact about the UI, and belongs where facts about the UI belong.
 *
 * `cooked` outweighs `accepted` because planning a meal is an intention and
 * cooking it is a completed act; the gap between the two is exactly the signal
 * we would lose by treating the plan as the outcome.
 *
 * `dismissed` is heavier than `accepted` on purpose. Rejection is the rarer and
 * more deliberate action — a user scrolls past a hundred things they are mildly
 * uninterested in and dismisses the one they actively do not want.
 */
const ACTION_WEIGHT: Record<RecommendationEventAction, number> = {
  cooked: 1,
  accepted: 0.6,
  dismissed: -0.8,
  shown: 0,
};

/**
 * How long a signal takes to lose half its strength.
 *
 * Tastes change, and a month is roughly the horizon over which "I have been
 * cooking a lot of Thai food" stops being true without anyone saying so. Long
 * enough that a fortnight's holiday does not wipe a user's profile; short enough
 * that last spring's phase does not outvote this week's cooking.
 */
const HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * How much accumulated evidence approaches a full ±1.
 *
 * At this scale a single accepted suggestion moves an ingredient to ~0.29 and a
 * single cook to ~0.46 — present, but nothing like the ±1 a user gets for typing
 * the ingredient into their settings. Three cooks reach ~0.9. That ordering is
 * the point: what someone tells us outranks what we inferred, until we have
 * inferred it many times over.
 */
const AFFINITY_SCALE = 2;

/**
 * Below this an ingredient is noise, and shipping it would just cost payload for
 * a weight that cannot change an ordering.
 */
const AFFINITY_FLOOR = 0.05;

/**
 * How many ingredient weights travel in the request. The ranker looks each
 * candidate's ingredients up in this map, so the tail contributes almost
 * nothing while costing bytes on every single recommendation call.
 */
const MAX_AFFINITIES = 50;

/** One row of the event log, reduced to what the fold reads. */
export interface FoldableEvent {
  recipeId: string;
  action: RecommendationEventAction;
  /**
   * The recipe's canonical ingredients AS THEY WERE when the event happened.
   *
   * Denormalized onto the event for the same reason `nutritionLog.snapshot` is:
   * an event is a historical fact, and re-deriving it from a recipe that has
   * since been edited or deleted would silently rewrite what the user did.
   * Convex also cannot look ingredients up on its own — recipe bodies live in
   * recipe-service, and a mutation cannot fetch.
   *
   * Absent on events recorded without them. Such an event still counts toward
   * `interactions` (which is per recipe) and contributes nothing to
   * `affinities` (which is per ingredient) — a partial record, honestly read.
   */
  canonicalItems?: string[];
  createdAt: number;
}

export interface DerivedSignal {
  /** canonicalItem → [-1, 1]. Empty means "no signal", not "all neutral". */
  affinities: Record<string, number>;
  /** recipeId → recent interaction counts, for the discovery ranker's novelty. */
  interactions: Record<string, RecommendationInteraction>;
}

/** Half-life decay: 1 at the moment of the event, 0.5 one half-life later. */
function recencyWeight(createdAt: number, now: number): number {
  const age = now - createdAt;
  // A clock skew that puts an event in the future is not evidence that it
  // matters more than the present. Clamp rather than amplify.
  if (age <= 0) return 1;
  return 0.5 ** (age / HALF_LIFE_MS);
}

/**
 * Fold a recent window of events into the derived signal the ranker reads.
 *
 * The caller decides the window; this function only decays what it is given.
 * That split keeps the recency policy where the database query is and keeps this
 * function a pure function of its arguments.
 */
export function deriveSignal(events: FoldableEvent[], now: number): DerivedSignal {
  const raw: Record<string, number> = {};
  const interactions: Record<string, RecommendationInteraction> = {};

  for (const event of events) {
    interactions[event.recipeId] ??= { shown: 0, accepted: 0, dismissed: 0, cooked: 0 };
    interactions[event.recipeId][event.action] += 1;

    const weight = ACTION_WEIGHT[event.action];
    // `shown` weighs nothing, so it never reaches the ingredient map at all —
    // it has already done its job in `interactions` above.
    if (weight === 0 || event.canonicalItems === undefined) continue;

    const decayed = weight * recencyWeight(event.createdAt, now);
    // De-duplicated per event: a recipe listing garlic twice is one opinion
    // about garlic, not two.
    for (const item of new Set(event.canonicalItems)) {
      if (item === "") continue;
      raw[item] = (raw[item] ?? 0) + decayed;
    }
  }

  const affinities: Record<string, number> = {};
  const scored = Object.entries(raw)
    .map(([item, sum]) => [item, Math.tanh(sum / AFFINITY_SCALE)] as const)
    .filter(([, value]) => Math.abs(value) >= AFFINITY_FLOOR)
    // Strongest opinions first — in EITHER direction. A firm dislike is as
    // useful to the ranker as a firm like, and truncating by signed value would
    // throw away every dislike before the first weak like.
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]) || a[0].localeCompare(b[0]))
    .slice(0, MAX_AFFINITIES);
  for (const [item, value] of scored) affinities[item] = value;

  return { affinities, interactions };
}
