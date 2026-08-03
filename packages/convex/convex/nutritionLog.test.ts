import type { NutritionEstimate } from "@pantry/types";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

const USER_ID = "user-a";
const identity = { subject: `${USER_ID}|session` };
const WEEK_START = "2026-08-03"; // a Monday

function estimate(over: Partial<{ kcal: number; protein: number; coverage: number }> = {}) {
  return {
    nutrients: {
      "1008": { nutrientId: "1008", amount: over.kcal ?? 600, unit: "kcal" },
      "1003": { nutrientId: "1003", amount: over.protein ?? 40, unit: "g" },
    },
    perServing: {},
    servings: 4,
    coverage: {
      resolvedMassFraction: over.coverage ?? 0.95,
      resolvedCount: 5,
      totalCount: 5,
    },
    ingredients: [],
    estimatedAt: "2026-08-03T12:00:00.000Z",
  } satisfies NutritionEstimate;
}

function snapshot(over: Partial<{ kcal: number; coverage: number }> = {}) {
  const e = estimate(over);
  return { nutrients: e.nutrients, coverage: e.coverage, estimatedAt: e.estimatedAt };
}

/** recipe-service is reached with `fetch`; every test drives it through a stub. */
const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("RECIPE_SERVICE_URL", "http://recipe-service");
  vi.stubEnv("RECIPE_SERVICE_SECRET", "test-secret");
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => estimate(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function basketed(
  t: ReturnType<typeof convexTest>,
  rows: Array<{
    recipeId: string;
    title?: string;
    weekday?: number;
    servingsMultiplier?: number;
    type?: "meal" | "leftover";
  }>,
) {
  await t.run(async (ctx) => {
    for (const row of rows) {
      await ctx.db.insert("basket", {
        userId: USER_ID,
        recipeId: row.recipeId,
        title: row.title ?? row.recipeId,
        weekday: row.weekday,
        servingsMultiplier: row.servingsMultiplier,
        type: row.type,
      });
    }
  });
}

describe("nutritionLog.listRange", () => {
  it("returns only the authenticated user's rows, and only in range", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const base = { servings: 1, source: "planned" as const, snapshot: snapshot(), loggedAt: 0 };
      await ctx.db.insert("nutritionLog", {
        ...base,
        userId: USER_ID,
        date: "2026-08-04",
        recipeId: "in",
      });
      await ctx.db.insert("nutritionLog", {
        ...base,
        userId: USER_ID,
        date: "2026-07-01",
        recipeId: "before",
      });
      await ctx.db.insert("nutritionLog", {
        ...base,
        userId: "someone-else",
        date: "2026-08-04",
        recipeId: "theirs",
      });
    });

    const rows = await t
      .withIdentity(identity)
      .query(api.nutritionLog.listRange, { from: "2026-08-03", to: "2026-08-09" });

    expect(rows.map((r) => r.recipeId)).toEqual(["in"]);
  });

  it("returns the stored snapshot rather than re-estimating", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("nutritionLog", {
        userId: USER_ID,
        date: "2026-08-04",
        recipeId: "r1",
        servings: 2,
        source: "planned",
        // A vector that current food data would never produce again.
        snapshot: snapshot({ kcal: 1234 }),
        loggedAt: 0,
      });
    });

    const [row] = await t
      .withIdentity(identity)
      .query(api.nutritionLog.listRange, { from: "2026-08-03", to: "2026-08-09" });

    expect(row.snapshot.nutrients["1008"].amount).toBe(1234);
    expect(row.servings).toBe(2);
    // Nothing may reach recipe-service on a read of history.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated read", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.query(api.nutritionLog.listRange, { from: "2026-08-03", to: "2026-08-09" }),
    ).rejects.toThrow(/Not authenticated/);
  });
});

describe("nutritionLog.recordPlannedWeek", () => {
  it("writes one planned row per scheduled recipe, on its weekday", async () => {
    const t = convexTest(schema, modules);
    await basketed(t, [
      { recipeId: "r1", title: "Chilli", weekday: 0 },
      { recipeId: "r2", title: "Curry", weekday: 3 },
    ]);

    const result = await t
      .withIdentity(identity)
      .action(api.nutritionLog.recordPlannedWeek, { weekStart: WEEK_START });

    expect(result.written).toBe(2);
    const rows = await t
      .withIdentity(identity)
      .query(api.nutritionLog.listRange, { from: "2026-08-03", to: "2026-08-09" });
    expect(rows.map((r) => [r.date, r.recipeId, r.source])).toEqual([
      ["2026-08-03", "r1", "planned"],
      ["2026-08-06", "r2", "planned"],
    ]);
  });

  it("skips unscheduled recipes — a plan-rail recipe was not eaten on any day", async () => {
    const t = convexTest(schema, modules);
    await basketed(t, [{ recipeId: "r1", weekday: 0 }, { recipeId: "unscheduled" }]);

    const result = await t
      .withIdentity(identity)
      .action(api.nutritionLog.recordPlannedWeek, { weekStart: WEEK_START });

    expect(result.written).toBe(1);
  });

  it("logs leftovers — they are not bought again, but they are still eaten", async () => {
    const t = convexTest(schema, modules);
    await basketed(t, [{ recipeId: "r1", weekday: 1, type: "leftover" }]);

    const result = await t
      .withIdentity(identity)
      .action(api.nutritionLog.recordPlannedWeek, { weekStart: WEEK_START });

    expect(result.written).toBe(1);
  });

  it("carries the servings multiplier onto the row", async () => {
    const t = convexTest(schema, modules);
    await basketed(t, [{ recipeId: "r1", weekday: 0, servingsMultiplier: 2 }]);

    await t.withIdentity(identity).action(api.nutritionLog.recordPlannedWeek, {
      weekStart: WEEK_START,
    });

    const [row] = await t
      .withIdentity(identity)
      .query(api.nutritionLog.listRange, { from: "2026-08-03", to: "2026-08-09" });
    // The snapshot stays one whole yield; the multiplier records the quantity.
    expect(row.servings).toBe(2);
    expect(row.snapshot.nutrients["1008"].amount).toBe(600);
  });

  it("stores coverage alongside the vector", async () => {
    const t = convexTest(schema, modules);
    await basketed(t, [{ recipeId: "r1", weekday: 0 }]);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => estimate({ coverage: 0.42 }),
    });

    await t
      .withIdentity(identity)
      .action(api.nutritionLog.recordPlannedWeek, { weekStart: WEEK_START });

    const [row] = await t
      .withIdentity(identity)
      .query(api.nutritionLog.listRange, { from: "2026-08-03", to: "2026-08-09" });
    expect(row.snapshot.coverage.resolvedMassFraction).toBe(0.42);
  });

  it("is idempotent — running it twice does not double-count the week", async () => {
    const t = convexTest(schema, modules);
    await basketed(t, [{ recipeId: "r1", weekday: 0 }]);
    const asUser = t.withIdentity(identity);

    await asUser.action(api.nutritionLog.recordPlannedWeek, { weekStart: WEEK_START });
    await asUser.action(api.nutritionLog.recordPlannedWeek, { weekStart: WEEK_START });

    const rows = await asUser.query(api.nutritionLog.listRange, {
      from: "2026-08-03",
      to: "2026-08-09",
    });
    expect(rows).toHaveLength(1);
  });

  it("drops a planned row when the plan no longer schedules it", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(identity);
    await basketed(t, [{ recipeId: "r1", weekday: 0 }]);
    await asUser.action(api.nutritionLog.recordPlannedWeek, { weekStart: WEEK_START });

    // The cook moves the dish from Monday to Thursday.
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("basket")
        .withIndex("by_user_recipe", (q) => q.eq("userId", USER_ID).eq("recipeId", "r1"))
        .unique();
      if (row) await ctx.db.patch(row._id, { weekday: 3 });
    });
    const result = await asUser.action(api.nutritionLog.recordPlannedWeek, {
      weekStart: WEEK_START,
    });

    expect(result.removed).toBe(1);
    const rows = await asUser.query(api.nutritionLog.listRange, {
      from: "2026-08-03",
      to: "2026-08-09",
    });
    expect(rows.map((r) => r.date)).toEqual(["2026-08-06"]);
  });

  it("leaves other weeks alone", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("nutritionLog", {
        userId: USER_ID,
        date: "2026-07-27",
        recipeId: "last-week",
        servings: 1,
        source: "planned",
        snapshot: snapshot(),
        loggedAt: 0,
      });
    });
    await basketed(t, [{ recipeId: "r1", weekday: 0 }]);

    await t
      .withIdentity(identity)
      .action(api.nutritionLog.recordPlannedWeek, { weekStart: WEEK_START });

    const rows = await t
      .withIdentity(identity)
      .query(api.nutritionLog.listRange, { from: "2026-07-01", to: "2026-08-09" });
    expect(rows.map((r) => r.recipeId)).toEqual(["last-week", "r1"]);
  });

  it("skips a recipe it cannot estimate without losing the rest of the week", async () => {
    const t = convexTest(schema, modules);
    await basketed(t, [
      { recipeId: "gone", title: "Deleted", weekday: 0 },
      { recipeId: "r2", title: "Curry", weekday: 1 },
    ]);
    fetchMock.mockImplementation(async (url: string) =>
      url.includes("/recipes/gone/")
        ? { ok: false, status: 404, json: async () => ({}) }
        : { ok: true, status: 200, json: async () => estimate() },
    );

    const result = await t
      .withIdentity(identity)
      .action(api.nutritionLog.recordPlannedWeek, { weekStart: WEEK_START });

    expect(result.written).toBe(1);
    expect(result.skipped).toEqual([
      { recipeId: "gone", title: "Deleted", reason: expect.stringContaining("404") },
    ]);
  });

  it("rejects an unauthenticated write", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.action(api.nutritionLog.recordPlannedWeek, { weekStart: WEEK_START }),
    ).rejects.toThrow(/Not authenticated/);
  });

  it("does not touch another user's log", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("nutritionLog", {
        userId: "someone-else",
        date: "2026-08-03",
        recipeId: "theirs",
        servings: 1,
        source: "planned",
        snapshot: snapshot(),
        loggedAt: 0,
      });
    });
    await basketed(t, [{ recipeId: "r1", weekday: 0 }]);

    await t
      .withIdentity(identity)
      .action(api.nutritionLog.recordPlannedWeek, { weekStart: WEEK_START });

    const theirs = await t.run(async (ctx) =>
      ctx.db
        .query("nutritionLog")
        .withIndex("by_user_date", (q) => q.eq("userId", "someone-else"))
        .collect(),
    );
    expect(theirs).toHaveLength(1);
  });
});

/**
 * BL-0028 has not landed, so nothing writes `cooked` rows yet. These guard the
 * seam it will use: the same row, upgraded in place, and safe from every
 * subsequent plan sync.
 */
describe("nutritionLog — the cooked upgrade path (BL-0028)", () => {
  it("upgrades the same row rather than creating a second one", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(identity);
    await basketed(t, [{ recipeId: "r1", weekday: 0 }]);
    await asUser.action(api.nutritionLog.recordPlannedWeek, { weekStart: WEEK_START });

    const id = await t.run(async (ctx) => {
      const row = await ctx.db
        .query("nutritionLog")
        .withIndex("by_user_date_recipe", (q) =>
          q.eq("userId", USER_ID).eq("date", "2026-08-03").eq("recipeId", "r1"),
        )
        .unique();
      if (!row) throw new Error("expected a planned row");
      // What "mark cooked" will do: one patch, no migration, no second table.
      await ctx.db.patch(row._id, { source: "cooked", servings: 1.5 });
      return row._id;
    });

    const rows = await asUser.query(api.nutritionLog.listRange, {
      from: "2026-08-03",
      to: "2026-08-09",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "cooked", servings: 1.5 });
    expect(id).toBeDefined();
  });

  it("never overwrites a cooked row from the plan", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(identity);
    await t.run(async (ctx) => {
      await ctx.db.insert("nutritionLog", {
        userId: USER_ID,
        date: "2026-08-03",
        recipeId: "r1",
        servings: 3,
        source: "cooked",
        snapshot: snapshot({ kcal: 999 }),
        loggedAt: 0,
      });
    });
    await basketed(t, [{ recipeId: "r1", weekday: 0 }]);

    const result = await asUser.action(api.nutritionLog.recordPlannedWeek, {
      weekStart: WEEK_START,
    });

    expect(result.preserved).toBe(1);
    const [row] = await asUser.query(api.nutritionLog.listRange, {
      from: "2026-08-03",
      to: "2026-08-09",
    });
    // The user's own account of the meal survives intact.
    expect(row).toMatchObject({ source: "cooked", servings: 3 });
    expect(row.snapshot.nutrients["1008"].amount).toBe(999);
  });

  it("never deletes a cooked row that the plan has dropped", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(identity);
    await t.run(async (ctx) => {
      await ctx.db.insert("nutritionLog", {
        userId: USER_ID,
        date: "2026-08-05",
        recipeId: "eaten",
        servings: 1,
        source: "cooked",
        snapshot: snapshot(),
        loggedAt: 0,
      });
      await ctx.db.insert("nutritionLog", {
        userId: USER_ID,
        date: "2026-08-05",
        recipeId: "hand-logged",
        servings: 1,
        source: "manual",
        snapshot: snapshot(),
        loggedAt: 0,
      });
    });
    // The plan for this week no longer mentions either dish.
    await basketed(t, [{ recipeId: "r1", weekday: 0 }]);

    const result = await asUser.action(api.nutritionLog.recordPlannedWeek, {
      weekStart: WEEK_START,
    });

    expect(result.removed).toBe(0);
    const rows = await asUser.query(api.nutritionLog.listRange, {
      from: "2026-08-03",
      to: "2026-08-09",
    });
    expect(rows.map((r) => r.recipeId).sort()).toEqual(["eaten", "hand-logged", "r1"]);
  });
});

describe("nutritionLog.syncPlannedWeek", () => {
  it("skips a basket row with an impossible weekday rather than filing it under a wrong date", async () => {
    const t = convexTest(schema, modules);
    await basketed(t, [
      { recipeId: "bad", weekday: 9 },
      { recipeId: "r2", weekday: 1 },
    ]);

    const result = await t.withIdentity(identity).action(api.nutritionLog.recordPlannedWeek, {
      weekStart: WEEK_START,
    });

    expect(result.written).toBe(1);
    expect(result.skipped[0]).toMatchObject({
      recipeId: "bad",
      reason: expect.stringContaining("0..6"),
    });
  });

  it("rejects a malformed week start", async () => {
    const t = convexTest(schema, modules);
    await basketed(t, [{ recipeId: "r1", weekday: 0 }]);

    await expect(
      t
        .withIdentity(identity)
        .action(api.nutritionLog.recordPlannedWeek, { weekStart: "3 Aug 2026" }),
    ).rejects.toThrow(/YYYY-MM-DD/);
  });

  it("is reachable only as an internal mutation", () => {
    expect(internal.nutritionLog.syncPlannedWeek).toBeDefined();
    expect("syncPlannedWeek" in api.nutritionLog).toBe(false);
  });
});
