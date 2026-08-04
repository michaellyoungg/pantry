import { describe, expect, it } from "vitest";
import type { PlannedItem } from "./planner";
import {
  type SuggestionCandidate,
  suggestWeek,
  VARIETY_SIMILARITY_THRESHOLD,
  WEEK_SUGGESTION_WEIGHTS,
} from "./weekSuggestion";

/**
 * Build a candidate. `have` is what the user owns; `missing` is what they would
 * buy — the split the ranker already made, which selection reads but never
 * recomputes.
 */
function candidate(
  recipeId: string,
  score: number,
  { have = [], missing = [] }: { have?: string[]; missing?: string[] } = {},
): SuggestionCandidate {
  return {
    recipeId,
    title: recipeId,
    score,
    reasons: [],
    have,
    missing: missing.map((canonicalItem) => ({ canonicalItem, display: canonicalItem })),
  };
}

function planned(recipeId: string, weekday?: number): PlannedItem {
  return { _id: `id-${recipeId}`, recipeId, title: recipeId, weekday };
}

const ids = (s: { picks: { recipeId: string }[] }) => s.picks.map((p) => p.recipeId);

describe("suggestWeek", () => {
  it("picks the top-ranked recipe first", () => {
    const s = suggestWeek({
      candidates: [
        candidate("mid", 0.5, { missing: ["a"] }),
        candidate("best", 0.9, { missing: ["z"] }),
        candidate("low", 0.1, { missing: ["b"] }),
      ],
      planned: [],
      maxPicks: 1,
    });
    expect(ids(s)).toEqual(["best"]);
  });

  it("fills days in calendar order", () => {
    const s = suggestWeek({
      candidates: [candidate("a", 0.9), candidate("b", 0.8), candidate("c", 0.7)],
      planned: [],
      maxPicks: 3,
    });
    expect(s.picks.map((p) => p.weekday)).toEqual([0, 1, 2]);
  });

  it("stops when the pool runs dry rather than repeating a recipe", () => {
    const s = suggestWeek({
      candidates: [candidate("a", 0.9), candidate("b", 0.8)],
      planned: [],
    });
    expect(ids(s)).toEqual(["a", "b"]);
  });

  // The marginal-gain half of the feature: a slightly worse recipe that reuses
  // what is already being bought beats a slightly better one that does not.
  it("prefers a candidate that shares shopping items with what is chosen", () => {
    const s = suggestWeek({
      candidates: [
        candidate("anchor", 0.9, { missing: ["chicken", "rice"] }),
        candidate("shares", 0.6, { missing: ["chicken", "salsa"] }),
        candidate("disjoint", 0.65, { missing: ["salmon", "dill"] }),
      ],
      planned: [],
      maxPicks: 2,
    });
    expect(ids(s)).toEqual(["anchor", "shares"]);
  });

  // ...but not at any price. The bonus reorders near-equals; it does not let a
  // bad recipe win on a technicality.
  it("does not let the overlap bonus overturn a much better recipe", () => {
    const s = suggestWeek({
      candidates: [
        candidate("anchor", 0.9, { missing: ["chicken", "rice"] }),
        candidate("shares", 0.2, { missing: ["chicken"] }),
        candidate("better", 0.8, { missing: ["salmon", "dill"] }),
      ],
      planned: [],
      maxPicks: 2,
    });
    expect(ids(s)).toEqual(["anchor", "better"]);
  });

  // The variety half. A near-duplicate shares everything, so the overlap bonus
  // loves it — the similarity penalty has to be the stronger of the two or the
  // week becomes the same dinner five times.
  it("penalizes a near-duplicate of an already-chosen dinner", () => {
    const s = suggestWeek({
      candidates: [
        candidate("anchor", 0.9, { missing: ["pasta", "tomato", "basil", "garlic"] }),
        candidate("clone", 0.85, { missing: ["pasta", "tomato", "basil", "garlic"] }),
        candidate("different", 0.6, { missing: ["tofu", "soy sauce", "ginger"] }),
      ],
      planned: [],
      maxPicks: 2,
    });
    expect(ids(s)).toEqual(["anchor", "different"]);
  });

  it("breaks ties on recipe id so the same inputs always give the same week", () => {
    const a = suggestWeek({
      candidates: [candidate("zebra", 0.5), candidate("apple", 0.5)],
      planned: [],
      maxPicks: 1,
    });
    const b = suggestWeek({
      candidates: [candidate("apple", 0.5), candidate("zebra", 0.5)],
      planned: [],
      maxPicks: 1,
    });
    expect(ids(a)).toEqual(["apple"]);
    expect(ids(b)).toEqual(["apple"]);
  });

  it("returns an empty proposal when there is nothing to propose", () => {
    const s = suggestWeek({ candidates: [], planned: [] });
    expect(s.picks).toEqual([]);
    expect(s.setReasons).toEqual([]);
  });

  describe("locked days", () => {
    it("never proposes anything for a day that is already planned", () => {
      const s = suggestWeek({
        candidates: [candidate("a", 0.9), candidate("b", 0.8), candidate("c", 0.7)],
        planned: [planned("already", 2)],
      });
      expect(s.lockedWeekdays).toEqual([2]);
      expect(s.picks.map((p) => p.weekday)).not.toContain(2);
    });

    it("never re-proposes a recipe that is already scheduled", () => {
      const s = suggestWeek({
        candidates: [candidate("scheduled", 0.99), candidate("other", 0.5)],
        planned: [planned("scheduled", 0)],
      });
      expect(ids(s)).toEqual(["other"]);
    });

    // An unscheduled basket row is not a locked day — placing it on one is
    // exactly the help the user asked for.
    it("still proposes basket recipes that have no day yet", () => {
      const s = suggestWeek({
        candidates: [candidate("onRail", 0.9)],
        planned: [planned("onRail", undefined)],
        maxPicks: 1,
      });
      expect(ids(s)).toEqual(["onRail"]);
    });

    // The locked meal anchors the set: Wednesday's chicken should pull the
    // proposal toward dishes that share it.
    it("scores candidates against what the locked days already commit", () => {
      const s = suggestWeek({
        candidates: [
          candidate("locked", 0.9, { missing: ["chicken", "rice"] }),
          candidate("sharesLocked", 0.5, { missing: ["chicken", "tortilla"] }),
          candidate("disjoint", 0.55, { missing: ["beef", "noodle"] }),
        ],
        planned: [planned("locked", 3)],
        maxPicks: 1,
      });
      expect(ids(s)).toEqual(["sharesLocked"]);
    });

    // A locked recipe we have no candidate row for cannot anchor anything, but
    // it must still hold its day.
    it("holds a locked day even when the recipe is not among the candidates", () => {
      const s = suggestWeek({
        candidates: [candidate("a", 0.9)],
        planned: [planned("vanished", 1)],
        maxPicks: 7,
      });
      expect(s.lockedWeekdays).toEqual([1]);
      expect(s.picks.map((p) => p.weekday)).not.toContain(1);
    });

    it("leaves nothing to fill when every day is spoken for", () => {
      const s = suggestWeek({
        candidates: [candidate("a", 0.9)],
        planned: [0, 1, 2, 3, 4, 5, 6].map((d) => planned(`p${d}`, d)),
      });
      expect(s.picks).toEqual([]);
    });
  });

  describe("set-level explanation", () => {
    it("names the ingredient the week shares and how many dinners share it", () => {
      const s = suggestWeek({
        candidates: [
          candidate("a", 0.9, { missing: ["chicken", "rice"] }),
          candidate("b", 0.8, { missing: ["chicken", "salsa"] }),
          candidate("c", 0.7, { missing: ["chicken", "lemon"] }),
        ],
        planned: [],
        maxPicks: 3,
      });
      expect(s.setReasons).toContain("3 dinners share chicken");
    });

    it("counts the shopping list once, and says what it would have been", () => {
      const s = suggestWeek({
        candidates: [
          candidate("a", 0.9, { missing: ["chicken", "rice"] }),
          candidate("b", 0.8, { missing: ["chicken", "rice", "salsa"] }),
        ],
        planned: [],
        maxPicks: 2,
      });
      expect(s.shoppingItemCount).toBe(3);
      expect(s.shoppingItemCountIfSeparate).toBe(5);
      expect(s.setReasons).toContain("One shopping list: 3 things to buy, not 5");
    });

    it("does not boast about a saving it did not make", () => {
      const s = suggestWeek({
        candidates: [
          candidate("a", 0.9, { missing: ["chicken"] }),
          candidate("b", 0.8, { missing: ["salmon"] }),
        ],
        planned: [],
        maxPicks: 2,
      });
      expect(s.setReasons.some((r) => r.startsWith("One shopping list"))).toBe(false);
    });

    it("reports how much of the week comes out of the pantry", () => {
      const s = suggestWeek({
        candidates: [
          candidate("a", 0.9, { have: ["onion"], missing: ["chicken"] }),
          candidate("b", 0.8, { missing: ["salmon"] }),
        ],
        planned: [],
        maxPicks: 2,
      });
      expect(s.setReasons).toContain("1 of 2 use something you already have");
    });

    it("claims variety only when the dinners really are different", () => {
      const varied = suggestWeek({
        candidates: [
          candidate("a", 0.9, { missing: ["chicken", "rice"] }),
          candidate("b", 0.8, { missing: ["tofu", "ginger"] }),
          candidate("c", 0.7, { missing: ["beef", "noodle"] }),
        ],
        planned: [],
        maxPicks: 3,
      });
      expect(varied.setReasons).toContain("3 dinners, no two alike");
    });

    it("makes no variety claim for a week of only two dinners", () => {
      const s = suggestWeek({
        candidates: [
          candidate("a", 0.9, { missing: ["chicken"] }),
          candidate("b", 0.8, { missing: ["tofu"] }),
        ],
        planned: [],
        maxPicks: 2,
      });
      expect(s.setReasons.some((r) => r.includes("no two alike"))).toBe(false);
    });

    it("says nothing at all about a week it did not fill", () => {
      const s = suggestWeek({
        candidates: [],
        planned: [planned("x", 0)],
      });
      expect(s.setReasons).toEqual([]);
    });
  });

  describe("per-pick explanation", () => {
    it("names what a pick shares with the rest of the week", () => {
      const s = suggestWeek({
        candidates: [
          candidate("a", 0.9, { missing: ["chicken", "rice"] }),
          candidate("b", 0.5, { missing: ["chicken", "salsa"] }),
        ],
        planned: [],
        maxPicks: 2,
      });
      expect(s.picks[0].sharesWith).toEqual([]);
      expect(s.picks[1].sharesWith).toEqual(["chicken"]);
    });

    it("names only what a pick adds to the list, not everything it needs", () => {
      const s = suggestWeek({
        candidates: [
          candidate("a", 0.9, { missing: ["chicken", "rice"] }),
          candidate("b", 0.5, { missing: ["chicken", "salsa"] }),
        ],
        planned: [],
        maxPicks: 2,
      });
      expect(s.picks[1].addsToList).toEqual(["salsa"]);
    });

    it("carries the ranker's own score and reasons through untouched", () => {
      const c = candidate("a", 0.72, { missing: ["chicken"] });
      c.reasons = ["Uses up: chicken"];
      const s = suggestWeek({ candidates: [c], planned: [], maxPicks: 1 });
      expect(s.picks[0].score).toBe(0.72);
      expect(s.picks[0].reasons).toEqual(["Uses up: chicken"]);
    });

    it("uses the recipe's own wording for an item, not the canonical id", () => {
      const s = suggestWeek({
        candidates: [
          {
            recipeId: "a",
            title: "A",
            score: 0.9,
            reasons: [],
            have: [],
            missing: [{ canonicalItem: "chicken breast", display: "boneless chicken breasts" }],
          },
        ],
        planned: [],
        maxPicks: 1,
      });
      expect(s.picks[0].addsToList).toEqual(["boneless chicken breasts"]);
    });
  });

  // Hand-tuned like the ranker's own weights, and pinned for the same reason:
  // a retune should be a deliberate, visible diff, not a drift.
  it("pins the set-level weights", () => {
    expect(WEEK_SUGGESTION_WEIGHTS).toEqual({ overlapBonus: 0.35, similarityPenalty: 0.8 });
    expect(VARIETY_SIMILARITY_THRESHOLD).toBe(0.35);
  });
});
