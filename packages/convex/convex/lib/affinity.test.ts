import { describe, expect, it } from "vitest";
import { deriveSignal, type FoldableEvent } from "./affinity";

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;

function event(over: Partial<FoldableEvent> = {}): FoldableEvent {
  return {
    recipeId: "r1",
    action: "accepted",
    canonicalItems: ["garlic"],
    createdAt: NOW,
    ...over,
  };
}

describe("deriveSignal — the cold-start rule", () => {
  // THE rule. A user who has done nothing has told us nothing, and the ranker
  // must be able to tell that apart from "everything scores zero". An empty map
  // is what makes the Go side report the feature UNAVAILABLE; a map of zeroes
  // would make it available and punish every candidate.
  it("returns an empty affinity map for a user with no events", () => {
    const { affinities } = deriveSignal([], NOW);
    expect(affinities).toEqual({});
  });

  it("never emits a zero-valued weight", () => {
    // A dismissal and a cook that cancel out must leave the item OUT of the map
    // rather than in it at 0 — an ingredient we have no net opinion about is
    // indistinguishable from one we have never seen, and both are "no signal".
    // One cook (+1.0) and one accept (+0.6) against two dismissals (-0.8 each)
    // is a net of exactly nothing.
    const { affinities } = deriveSignal(
      [
        event({ action: "cooked", canonicalItems: ["chard"] }),
        event({ action: "accepted", canonicalItems: ["chard"] }),
        event({ action: "dismissed", canonicalItems: ["chard"] }),
        event({ action: "dismissed", canonicalItems: ["chard"] }),
      ],
      NOW,
    );
    for (const value of Object.values(affinities)) {
      expect(value).not.toBe(0);
    }
    expect(affinities.chard).toBeUndefined();
  });

  // An impression is not an opinion: the user did not choose to be shown the
  // card, and learning from it would let the recommender teach itself its own
  // past decisions.
  it("gives shown events no affinity weight at all", () => {
    const { affinities } = deriveSignal(
      [event({ action: "shown", canonicalItems: ["garlic", "ginger"] })],
      NOW,
    );
    expect(affinities).toEqual({});
  });

  // ...but it still counts as an impression, which is the whole reason the row
  // is written.
  it("counts shown events in the per-recipe interactions", () => {
    const { interactions } = deriveSignal([event({ action: "shown" })], NOW);
    expect(interactions.r1).toEqual({ shown: 1, accepted: 0, dismissed: 0, cooked: 0 });
  });
});

describe("deriveSignal — reading behaviour", () => {
  it("upweights the ingredients of accepted and cooked recipes", () => {
    const { affinities } = deriveSignal(
      [event({ action: "cooked", canonicalItems: ["garlic", "ginger"] })],
      NOW,
    );
    expect(affinities.garlic).toBeGreaterThan(0);
    expect(affinities.ginger).toBeGreaterThan(0);
  });

  it("downweights the ingredients of dismissed recipes", () => {
    const { affinities } = deriveSignal(
      [event({ action: "dismissed", canonicalItems: ["cilantro"] })],
      NOW,
    );
    expect(affinities.cilantro).toBeLessThan(0);
  });

  // Planning a meal is an intention; cooking it is a completed act. The gap
  // between the two is exactly the signal we would lose by treating them alike.
  it("weighs a cook above an accept", () => {
    const cooked = deriveSignal([event({ action: "cooked", canonicalItems: ["a"] })], NOW);
    const accepted = deriveSignal([event({ action: "accepted", canonicalItems: ["a"] })], NOW);
    expect(cooked.affinities.a).toBeGreaterThan(accepted.affinities.a);
  });

  it("accumulates repeated behaviour toward a stronger opinion", () => {
    const once = deriveSignal([event({ action: "cooked", canonicalItems: ["a"] })], NOW);
    const thrice = deriveSignal(
      [
        event({ recipeId: "r1", action: "cooked", canonicalItems: ["a"] }),
        event({ recipeId: "r2", action: "cooked", canonicalItems: ["a"] }),
        event({ recipeId: "r3", action: "cooked", canonicalItems: ["a"] }),
      ],
      NOW,
    );
    expect(thrice.affinities.a).toBeGreaterThan(once.affinities.a);
    expect(thrice.affinities.a).toBeLessThanOrEqual(1);
  });

  // Saturating rather than relative normalization. The point is that a weight
  // means the same thing regardless of how much history sits beside it — under
  // relative normalization the strongest item would score 1 for every user
  // alive, and one click would look as certain as a year of cooking.
  it("does not rescale weak evidence up to the maximum", () => {
    const { affinities } = deriveSignal(
      [event({ action: "accepted", canonicalItems: ["a"] })],
      NOW,
    );
    expect(affinities.a).toBeLessThan(0.5);
    expect(affinities.a).toBeGreaterThan(0);
  });

  it("keeps every weight inside [-1, 1]", () => {
    const many: FoldableEvent[] = Array.from({ length: 50 }, (_, i) =>
      event({ recipeId: `r${i}`, action: "cooked", canonicalItems: ["a"] }),
    );
    const { affinities } = deriveSignal(many, NOW);
    expect(affinities.a).toBeLessThanOrEqual(1);
    expect(affinities.a).toBeGreaterThan(0.9);
  });

  // Tastes change. Last spring's phase must not outvote this week's cooking.
  it("decays older evidence", () => {
    const fresh = deriveSignal([event({ action: "cooked", canonicalItems: ["a"] })], NOW);
    const stale = deriveSignal(
      [event({ action: "cooked", canonicalItems: ["a"], createdAt: NOW - 60 * DAY })],
      NOW,
    );
    expect(stale.affinities.a).toBeLessThan(fresh.affinities.a);
  });

  // Clock skew is not evidence that something matters more than the present.
  it("does not amplify events dated in the future", () => {
    const future = deriveSignal(
      [event({ action: "cooked", canonicalItems: ["a"], createdAt: NOW + 10 * DAY })],
      NOW,
    );
    const present = deriveSignal([event({ action: "cooked", canonicalItems: ["a"] })], NOW);
    expect(future.affinities.a).toBeCloseTo(present.affinities.a, 10);
  });

  // A recipe listing garlic in two units is one opinion about garlic.
  it("de-duplicates ingredients within one event", () => {
    const twice = deriveSignal(
      [event({ action: "cooked", canonicalItems: ["garlic", "garlic"] })],
      NOW,
    );
    const once = deriveSignal([event({ action: "cooked", canonicalItems: ["garlic"] })], NOW);
    expect(twice.affinities.garlic).toBeCloseTo(once.affinities.garlic, 10);
  });

  // A partial record, honestly read: the event still happened to the RECIPE.
  it("counts an event with no ingredients toward interactions only", () => {
    const { affinities, interactions } = deriveSignal(
      [event({ action: "cooked", canonicalItems: undefined })],
      NOW,
    );
    expect(affinities).toEqual({});
    expect(interactions.r1.cooked).toBe(1);
  });
});

describe("deriveSignal — payload bounds", () => {
  it("caps how many weights travel in the request", () => {
    const events: FoldableEvent[] = Array.from({ length: 80 }, (_, i) =>
      event({ recipeId: `r${i}`, action: "cooked", canonicalItems: [`item-${i}`] }),
    );
    expect(Object.keys(deriveSignal(events, NOW).affinities)).toHaveLength(50);
  });

  // Truncating by SIGNED value would throw away every dislike before the first
  // weak like. A firm dislike is as useful to the ranker as a firm like.
  it("keeps the strongest opinions in either direction", () => {
    const events: FoldableEvent[] = [
      // A strong dislike, built from several dismissals.
      ...Array.from({ length: 4 }, (_, i) =>
        event({ recipeId: `d${i}`, action: "dismissed", canonicalItems: ["cilantro"] }),
      ),
      // ...and 60 barely-there likes that must not crowd it out.
      ...Array.from({ length: 60 }, (_, i) =>
        event({ recipeId: `a${i}`, action: "accepted", canonicalItems: [`filler-${i}`] }),
      ),
    ];
    const { affinities } = deriveSignal(events, NOW);
    expect(affinities.cilantro).toBeLessThan(-0.5);
  });
});
