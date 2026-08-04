import type { PlannedItem } from "./planner";
import { DAY_FULL } from "./week";

// "Suggest my week" — set-level meal plan selection (BL-0033).
//
// This is a SELECTION STRATEGY over the existing per-recipe scorer, not a second
// scorer. Every candidate arrives already ranked by recipe-service
// (internal/recommend), and its `score` is used here unchanged. What this module
// adds is the two properties that only exist across a plan and therefore cannot
// be expressed as a per-recipe feature:
//
//   - shared ingredients, so five dinners produce one short grocery list rather
//     than five disjoint ones, and
//   - variety, so the week is not the same dish four times.
//
// The method is greedy marginal gain: take the best candidate, re-score the
// remainder against what is now chosen, repeat. Deliberately not an exact
// optimizer — for 5–7 picks out of a small corpus an ILP buys a marginally
// better set at the cost of a result nobody can explain, and the explanation is
// the feature (see BL-0033's alternatives).
//
// Nothing here writes anything. The output is a PROPOSAL the caller renders and
// the user edits or discards; the anti-friction principle in the UX plan is that
// a suggestion you have to undo is worse than no suggestion at all.

/**
 * A ranked candidate as selection sees it.
 *
 * Structurally a subset of `Recommendation` from `@pantry/types`, declared
 * locally so this module stays pure domain logic with no wire-format dependency
 * — and so a test can build one in three lines.
 */
export type SuggestionCandidate = {
  recipeId: string;
  title: string;
  /** The ranker's per-recipe score, 0..1. Used as-is; never recomputed here. */
  score: number;
  reasons: string[];
  /** Canonical items the user already has. */
  have: string[];
  /** Canonical items the user would have to buy. */
  missing: { canonicalItem: string; display: string }[];
};

/** One proposed dinner: a candidate, the day it would land on, and why. */
export type SuggestedPick = {
  recipeId: string;
  title: string;
  /** 0=Mon … 6=Sun. */
  weekday: number;
  /** The ranker's own score, unchanged. */
  score: number;
  /** The score after the set-level bonus and penalty, at the moment of choosing. */
  marginalScore: number;
  /** The ranker's per-recipe reasons. */
  reasons: string[];
  /** Display names this pick shares with the rest of the week. */
  sharesWith: string[];
  /** Display names this pick alone adds to the shopping list. */
  addsToList: string[];
};

/** A whole proposed week, plus the set-level account of why it hangs together. */
export type WeekSuggestion = {
  picks: SuggestedPick[];
  /**
   * Why these dishes belong together — the point of the feature. Per-recipe
   * scores explain each dinner; only these explain the week.
   */
  setReasons: string[];
  /** Days left untouched because something was already scheduled on them. */
  lockedWeekdays: number[];
  /** Distinct items to buy for the whole proposed week. */
  shoppingItemCount: number;
  /** What those same dinners would cost in list lines with no sharing at all. */
  shoppingItemCountIfSeparate: number;
};

/**
 * The set-level weights, hand-tuned like the ranker's own and pinned by a test
 * so a change to either is a deliberate, visible diff.
 *
 * Both are scaled against a base score of 0..1. `similarityPenalty` is much the
 * larger on purpose: a near-duplicate dinner is a worse outcome than a slightly
 * longer shopping list, and a near-duplicate collects the full overlap bonus by
 * definition — sharing ingredients is exactly what duplicates do. The penalty
 * has to be able to outweigh that bonus, or the cheapest way to score well would
 * be to propose the same dish five nights running.
 */
export const WEEK_SUGGESTION_WEIGHTS = {
  overlapBonus: 0.35,
  similarityPenalty: 0.8,
} as const;

/**
 * How alike two dinners may be before they stop counting as different meals.
 *
 * This threshold is load-bearing, not cosmetic. The two set terms both key off
 * shared ingredients, so an ungated penalty would cancel the very bonus that
 * makes a week share a chicken: two dishes with one ingredient in common out of
 * four already sit at a Jaccard of 0.33. Gating the penalty here separates the
 * two intents cleanly — sharing ingredients is the GOAL and is never punished,
 * while being the same dish again is punished hard, on a ramp from this
 * threshold up to identity.
 */
export const VARIETY_SIMILARITY_THRESHOLD = 0.35;

/** How many ingredients a set reason names before it stops listing them. */
const MAX_NAMED_ITEMS = 3;

/** Every weekday the grid has, in the order empty days get filled. */
const ALL_WEEKDAYS = DAY_FULL.map((_, i) => i);

export type SuggestWeekInput = {
  /**
   * Every scored candidate, INCLUDING recipes already on the plan. The planned
   * ones are never proposed again; they are here so their ingredients can anchor
   * the set — a suggestion that shares Wednesday's chicken is the good outcome,
   * and it is unreachable if Wednesday's ingredients were filtered out upstream.
   */
  candidates: readonly SuggestionCandidate[];
  /** The basket, so scheduled rows lock their day and unscheduled ones stay eligible. */
  planned: readonly PlannedItem[];
  /** Cap on how many dinners to propose. Defaults to every open day. */
  maxPicks?: number;
};

type ChosenSet = {
  /** Canonical item -> how many dinners in the set use it. */
  itemCounts: Map<string, number>;
  /** Canonical items somebody in the set has to buy — the shopping list so far. */
  toBuy: Set<string>;
  /** Ingredient sets of the dinners chosen, for the similarity check. */
  itemSets: Set<string>[];
};

/**
 * Propose a week by greedy marginal gain.
 *
 * Days are filled in calendar order with the best remaining candidate, which
 * makes the result deterministic and the reasoning legible: pick one is simply
 * the top-ranked recipe, and every pick after it is the top-ranked recipe *given
 * the ones before it*.
 *
 * Already-scheduled days are never touched. That is the same non-destructive
 * diff-merge the grocery list uses on regeneration: someone who has planned
 * Wednesday must not lose it by pressing a button that offered them more.
 */
export function suggestWeek({ candidates, planned, maxPicks }: SuggestWeekInput): WeekSuggestion {
  const byId = new Map(candidates.map((c) => [c.recipeId, c]));

  const scheduled = planned.filter((p) => p.weekday != null);
  const lockedWeekdays = [...new Set(scheduled.map((p) => p.weekday as number))].sort(
    (a, b) => a - b,
  );
  const lockedDays = new Set(lockedWeekdays);
  const openWeekdays = ALL_WEEKDAYS.filter((d) => !lockedDays.has(d));

  // A recipe already sitting on a day is not a suggestion. An unscheduled basket
  // row still is: the user put it there, and placing it on a day is precisely
  // the help they asked for.
  const alreadyPlaced = new Set(scheduled.map((p) => p.recipeId));

  const chosen = emptySet();
  // Seed with the locked dinners so the proposal is measured against the week
  // the user actually has, not against an imaginary empty one. A locked recipe
  // we have no candidate row for (deleted, or filtered out by an avoid rule)
  // simply cannot anchor anything — better silent than invented.
  for (const row of scheduled) {
    const c = byId.get(row.recipeId);
    if (c) addToSet(chosen, c);
  }

  const pool = candidates.filter((c) => !alreadyPlaced.has(c.recipeId));
  const slots = Math.min(openWeekdays.length, maxPicks ?? openWeekdays.length);

  const picks: SuggestedPick[] = [];
  for (let i = 0; i < slots; i++) {
    const best = bestMarginal(pool, chosen);
    if (!best) break;

    const items = itemsOf(best.candidate);
    picks.push({
      recipeId: best.candidate.recipeId,
      title: best.candidate.title,
      weekday: openWeekdays[i],
      score: best.candidate.score,
      marginalScore: best.value,
      reasons: best.candidate.reasons,
      sharesWith: displayNames(
        [...items].filter((item) => (chosen.itemCounts.get(item) ?? 0) > 0),
        candidates,
      ),
      addsToList: displayNames(
        best.candidate.missing
          .map((m) => m.canonicalItem)
          .filter((item) => !chosen.toBuy.has(item)),
        candidates,
      ),
    });

    addToSet(chosen, best.candidate);
    pool.splice(pool.indexOf(best.candidate), 1);
  }

  // The locked dinners are part of the week's list too, so they count in BOTH
  // totals — `shoppingItemCount` already includes them, and leaving them out
  // here would compare two different weeks.
  const lineCount = (recipeId: string) => byId.get(recipeId)?.missing.length ?? 0;
  const separate =
    picks.reduce((n, p) => n + lineCount(p.recipeId), 0) +
    scheduled.reduce((n, r) => n + lineCount(r.recipeId), 0);

  return {
    picks,
    setReasons: setReasons(picks, chosen, candidates, byId, separate),
    lockedWeekdays,
    shoppingItemCount: chosen.toBuy.size,
    shoppingItemCountIfSeparate: separate,
  };
}

/** The candidate with the highest marginal gain; ties break on recipe id. */
function bestMarginal(
  pool: readonly SuggestionCandidate[],
  chosen: ChosenSet,
): { candidate: SuggestionCandidate; value: number } | null {
  let best: { candidate: SuggestionCandidate; value: number } | null = null;
  for (const candidate of pool) {
    const value = marginalScore(candidate, chosen);
    if (
      !best ||
      value > best.value ||
      (value === best.value && candidate.recipeId < best.candidate.recipeId)
    ) {
      best = { candidate, value };
    }
  }
  return best;
}

/**
 * What this candidate is worth GIVEN what is already chosen.
 *
 * The two set terms measure deliberately different things. Overlap is scored on
 * what you would have to BUY, because that is what a short shopping list is made
 * of — sharing a pantry staple you already own saves nobody a trip. Similarity
 * is scored on the whole ingredient set, because that is what makes two dinners
 * feel like the same dinner.
 */
function marginalScore(candidate: SuggestionCandidate, chosen: ChosenSet): number {
  return (
    candidate.score +
    WEEK_SUGGESTION_WEIGHTS.overlapBonus * shoppingOverlap(candidate, chosen) -
    WEEK_SUGGESTION_WEIGHTS.similarityPenalty * repetition(candidate, chosen)
  );
}

/**
 * The share of this candidate's shopping needs that the week is buying anyway,
 * 0..1.
 *
 * A candidate that needs nothing scores 1 rather than 0: it adds no line to the
 * list at all, which is the ideal this term exists to reward, and scoring the
 * best possible case as the worst would be perverse.
 */
function shoppingOverlap(candidate: SuggestionCandidate, chosen: ChosenSet): number {
  if (candidate.missing.length === 0) return 1;
  const fresh = candidate.missing.filter((m) => !chosen.toBuy.has(m.canonicalItem)).length;
  return 1 - fresh / candidate.missing.length;
}

/**
 * How much this candidate repeats an already-chosen dinner, 0..1.
 *
 * Peak rather than average: one near-duplicate is the thing being prevented, and
 * an average would let it hide behind four dissimilar picks.
 *
 * The raw Jaccard is then rescaled so that everything at or below
 * VARIETY_SIMILARITY_THRESHOLD is free and identity is 1 — see that constant for
 * why an ungated penalty would defeat the overlap bonus.
 */
function repetition(candidate: SuggestionCandidate, chosen: ChosenSet): number {
  const items = itemsOf(candidate);
  let peak = 0;
  for (const other of chosen.itemSets) {
    peak = Math.max(peak, jaccard(items, other));
  }
  if (peak <= VARIETY_SIMILARITY_THRESHOLD) return 0;
  return (peak - VARIETY_SIMILARITY_THRESHOLD) / (1 - VARIETY_SIMILARITY_THRESHOLD);
}

/** Overlap of two sets as a share of their union; 0 when both are empty. */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const x of a) if (b.has(x)) shared++;
  return shared / (a.size + b.size - shared);
}

/** Every canonical item a recipe uses, owned or not. */
function itemsOf(c: SuggestionCandidate): Set<string> {
  return new Set([...c.have, ...c.missing.map((m) => m.canonicalItem)]);
}

function emptySet(): ChosenSet {
  return { itemCounts: new Map(), toBuy: new Set(), itemSets: [] };
}

function addToSet(chosen: ChosenSet, c: SuggestionCandidate): void {
  const items = itemsOf(c);
  for (const item of items) {
    chosen.itemCounts.set(item, (chosen.itemCounts.get(item) ?? 0) + 1);
  }
  for (const m of c.missing) chosen.toBuy.add(m.canonicalItem);
  chosen.itemSets.push(items);
}

/**
 * The set-level explanation.
 *
 * Every line is derived from the chosen set, never asserted: the shared-item
 * count is counted, the shopping saving is subtracted, and the variety claim is
 * only made when the numbers support it. A set reason the user can check is the
 * difference between a recommendation and a slogan.
 */
function setReasons(
  picks: readonly SuggestedPick[],
  chosen: ChosenSet,
  candidates: readonly SuggestionCandidate[],
  byId: ReadonlyMap<string, SuggestionCandidate>,
  separate: number,
): string[] {
  if (picks.length === 0) return [];
  const out: string[] = [];

  // "3 dinners share chicken, rice" — the headline, and the reason a set beats
  // the same recipes ranked individually.
  const shared = [...chosen.itemCounts.entries()].filter(([, n]) => n >= 2);
  if (shared.length > 0) {
    const top = Math.max(...shared.map(([, n]) => n));
    const names = displayNames(
      shared
        .filter(([, n]) => n === top)
        .map(([item]) => item)
        .sort(),
      candidates,
    ).slice(0, MAX_NAMED_ITEMS);
    out.push(`${top} dinners share ${names.join(", ")}`);
  }

  if (chosen.toBuy.size > 0 && chosen.toBuy.size < separate) {
    out.push(`One shopping list: ${chosen.toBuy.size} things to buy, not ${separate}`);
  }

  const usingPantry = picks.filter((p) => (byId.get(p.recipeId)?.have.length ?? 0) > 0).length;
  if (usingPantry > 0) {
    out.push(
      usingPantry === picks.length
        ? `Every dinner uses something you already have`
        : `${usingPantry} of ${picks.length} use something you already have`,
    );
  }

  // Only claim variety when the picks actually are varied. Two dinners is not a
  // week, so the claim needs at least three to mean anything.
  if (picks.length >= 3 && peakPairwiseSimilarity(picks, byId) < VARIETY_SIMILARITY_THRESHOLD) {
    out.push(`${picks.length} dinners, no two alike`);
  }

  return out;
}

function peakPairwiseSimilarity(
  picks: readonly SuggestedPick[],
  byId: ReadonlyMap<string, SuggestionCandidate>,
): number {
  const sets = picks
    .map((p) => byId.get(p.recipeId))
    .filter((c): c is SuggestionCandidate => c !== undefined)
    .map(itemsOf);
  let peak = 0;
  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++) {
      peak = Math.max(peak, jaccard(sets[i], sets[j]));
    }
  }
  return peak;
}

/**
 * Canonical ids rendered for a human.
 *
 * Only `missing` entries carry a display name — `have` is a bare canonical id —
 * so a name is looked up across every candidate and falls back to the id
 * itself. The ids are already normalized lowercase words ("chicken breast"), so
 * the fallback reads fine; it is just less specific than the recipe's own
 * wording.
 */
function displayNames(
  items: readonly string[],
  candidates: readonly SuggestionCandidate[],
): string[] {
  const names = new Map<string, string>();
  for (const c of candidates) {
    for (const m of c.missing) {
      if (!names.has(m.canonicalItem)) names.set(m.canonicalItem, m.display);
    }
  }
  return items.map((item) => names.get(item) ?? item);
}
