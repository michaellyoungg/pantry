import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

const USER_ID = "ev-user";
const identity = { subject: `${USER_ID}|session` };

const DAY = 86_400_000;

function harness() {
  return convexTest(schema, modules).withIdentity(identity);
}

async function allEvents(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => ctx.db.query("recommendationEvents").collect());
}

describe("recording interactions", () => {
  it("stores a deliberate action with the recipe's canonical ingredients", async () => {
    const t = harness();
    await t.mutation(api.recommendationEvents.record, {
      recipeId: "r1",
      context: "discover",
      action: "accepted",
      canonicalItems: ["garlic", "ginger"],
    });

    const rows = await allEvents(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: USER_ID,
      recipeId: "r1",
      context: "discover",
      action: "accepted",
      canonicalItems: ["garlic", "ginger"],
    });
  });

  it("refuses to record for an unauthenticated caller", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(api.recommendationEvents.record, {
        recipeId: "r1",
        context: "discover",
        action: "accepted",
      }),
    ).rejects.toThrow(/Not authenticated/);
  });

  // Dismissing the same recipe twice is two statements, and the second one is
  // the user telling us the first did not take.
  it("does not de-duplicate deliberate actions", async () => {
    const t = harness();
    for (let i = 0; i < 2; i++) {
      await t.mutation(api.recommendationEvents.record, {
        recipeId: "r1",
        context: "discover",
        action: "dismissed",
        canonicalItems: ["cilantro"],
      });
    }
    expect(await allEvents(t)).toHaveLength(2);
  });
});

describe("impression de-duplication", () => {
  // Without this, every render writes a row per card and the impression rows
  // bury the intentional ones by orders of magnitude — the exact failure that
  // made the design reject impression logging outright.
  it("writes one impression per recipe per window, however often the card renders", async () => {
    const t = harness();
    for (let i = 0; i < 5; i++) {
      await t.mutation(api.recommendationEvents.recordShownBatch, {
        context: "discover",
        recipes: [
          { recipeId: "r1", canonicalItems: ["garlic"] },
          { recipeId: "r2", canonicalItems: ["oats"] },
        ],
      });
    }
    const rows = await allEvents(t);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.recipeId).sort()).toEqual(["r1", "r2"]);
  });

  it("records a fresh impression once the window has passed", async () => {
    const t = harness();
    await t.run(async (ctx) => {
      await ctx.db.insert("recommendationEvents", {
        userId: USER_ID,
        recipeId: "r1",
        context: "discover",
        action: "shown",
        createdAt: Date.now() - 2 * DAY,
      });
    });
    await t.mutation(api.recommendationEvents.recordShownBatch, {
      context: "discover",
      recipes: [{ recipeId: "r1", canonicalItems: ["garlic"] }],
    });
    expect(await allEvents(t)).toHaveLength(2);
  });

  // The dedupe scan reads a recipe's recent rows regardless of action, so a
  // recent impression sitting behind newer deliberate rows must still be found.
  it("finds a recent impression behind newer deliberate events", async () => {
    const t = harness();
    await t.mutation(api.recommendationEvents.recordShownBatch, {
      context: "discover",
      recipes: [{ recipeId: "r1", canonicalItems: ["garlic"] }],
    });
    await t.mutation(api.recommendationEvents.record, {
      recipeId: "r1",
      context: "discover",
      action: "accepted",
      canonicalItems: ["garlic"],
    });
    await t.mutation(api.recommendationEvents.recordShownBatch, {
      context: "discover",
      recipes: [{ recipeId: "r1", canonicalItems: ["garlic"] }],
    });

    const shown = (await allEvents(t)).filter((e) => e.action === "shown");
    expect(shown).toHaveLength(1);
  });
});

describe("the derived signal", () => {
  it("is empty for a user who has done nothing", async () => {
    const t = harness();
    const signal = await t.run(async (ctx) =>
      ctx.runQuery(internal.recommendationEvents.signalFor, { userId: USER_ID, now: Date.now() }),
    );
    expect(signal.affinities).toEqual({});
    expect(signal.interactions).toEqual({});
  });

  it("reads one user's events and never another's", async () => {
    const t = harness();
    await t.run(async (ctx) => {
      await ctx.db.insert("recommendationEvents", {
        userId: USER_ID,
        recipeId: "mine",
        context: "discover",
        action: "cooked",
        canonicalItems: ["garlic"],
        createdAt: Date.now(),
      });
      await ctx.db.insert("recommendationEvents", {
        userId: "someone-else",
        recipeId: "theirs",
        context: "discover",
        action: "cooked",
        canonicalItems: ["anchovy"],
        createdAt: Date.now(),
      });
    });

    const signal = await t.run(async (ctx) =>
      ctx.runQuery(internal.recommendationEvents.signalFor, { userId: USER_ID, now: Date.now() }),
    );
    expect(signal.affinities.garlic).toBeGreaterThan(0);
    expect(signal.affinities.anchovy).toBeUndefined();
    expect(Object.keys(signal.interactions)).toEqual(["mine"]);
  });

  // The window keeps the read bounded, so a recommendation call does not get
  // slower the longer somebody has used the product.
  it("ignores events older than the window", async () => {
    const now = Date.now();
    const t = harness();
    await t.run(async (ctx) => {
      await ctx.db.insert("recommendationEvents", {
        userId: USER_ID,
        recipeId: "ancient",
        context: "discover",
        action: "cooked",
        canonicalItems: ["garlic"],
        createdAt: now - 200 * DAY,
      });
    });

    const signal = await t.run(async (ctx) =>
      ctx.runQuery(internal.recommendationEvents.signalFor, { userId: USER_ID, now }),
    );
    expect(signal.affinities).toEqual({});
    expect(signal.interactions).toEqual({});
  });
});
