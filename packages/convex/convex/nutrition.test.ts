import type { NutritionEstimate } from "@pantry/types";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// The plan rollup's Convex side (BL-0037). recipe-service is stubbed: what needs
// pinning here is which basket entries become which requests — the leftover
// rule, the day bucketing, and the week being asked as its own call — not the
// nutrition arithmetic, which is tested in Go.
const modules = import.meta.glob("./**/*.*s");

const identity = { subject: "user-a|session" };

interface Recorded {
  path: string;
  items: Array<{ recipeId: string; multiplier: number }>;
}

function emptyEstimate(): NutritionEstimate {
  return {
    nutrients: {},
    servings: 0,
    coverage: { resolvedMassFraction: 1, resolvedCount: 0, totalCount: 0 },
    ingredients: [],
    estimatedAt: "2026-08-03T12:00:00Z",
    recipes: [],
  };
}

/** Stubs recipe-service and records the request bodies it was sent. */
function recordRequests(estimate: (body: Recorded) => NutritionEstimate = emptyEstimate) {
  const calls: Recorded[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const recorded: Recorded = {
        path: new URL(url).pathname,
        items: JSON.parse(init.body as string).items,
      };
      calls.push(recorded);
      return new Response(JSON.stringify(estimate(recorded)), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
  return calls;
}

async function seed(
  t: ReturnType<typeof convexTest>,
  rows: Array<{
    recipeId: string;
    title: string;
    weekday?: number;
    servingsMultiplier?: number;
    type?: "meal" | "leftover";
  }>,
) {
  await t.run(async (ctx) => {
    for (const row of rows) await ctx.db.insert("basket", { userId: "user-a", ...row });
  });
}

beforeEach(() => {
  process.env.RECIPE_SERVICE_URL = "http://recipe-service.test";
  process.env.RECIPE_SERVICE_SECRET = "test-secret";
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("nutrition.planNutrition", () => {
  it("asks for each planned day and for the week as its own call", async () => {
    const calls = recordRequests();
    const t = convexTest(schema, modules);
    await seed(t, [
      { recipeId: "r1", title: "Pancakes", weekday: 0 },
      { recipeId: "r2", title: "Chili", weekday: 3 },
    ]);

    const result = await t.withIdentity(identity).action(api.nutrition.planNutrition, {});

    expect(calls).toHaveLength(3);
    expect(calls.every((c) => c.path === "/nutrition/estimate")).toBe(true);
    // The week is one request over the whole plan, not the sum of the days: a
    // coverage fraction is a ratio, and averaging ratios is not the ratio.
    expect(calls[0].items.map((i) => i.recipeId).sort()).toEqual(["r1", "r2"]);
    expect(result.days.map((d) => d.weekday)).toEqual([0, 3]);
    expect(result.week).not.toBeNull();
  });

  // The inverse of the grocery rule: a leftover buys nothing but is still eaten.
  it("counts leftovers", async () => {
    const calls = recordRequests();
    const t = convexTest(schema, modules);
    await seed(t, [
      { recipeId: "r1", title: "Chili", weekday: 0, type: "meal" },
      { recipeId: "r2", title: "Chili again", weekday: 1, type: "leftover" },
    ]);

    await t.withIdentity(identity).action(api.nutrition.planNutrition, {});

    expect(calls[0].items.map((i) => i.recipeId).sort()).toEqual(["r1", "r2"]);
    const tuesday = calls.find((c) => c.items[0]?.recipeId === "r2");
    expect(tuesday?.items).toEqual([{ recipeId: "r2", multiplier: 1 }]);
  });

  it("carries the servings multiplier, defaulting to one batch", async () => {
    const calls = recordRequests();
    const t = convexTest(schema, modules);
    await seed(t, [
      { recipeId: "r1", title: "Pancakes", weekday: 0, servingsMultiplier: 2.5 },
      { recipeId: "r2", title: "Chili", weekday: 0 },
    ]);

    await t.withIdentity(identity).action(api.nutrition.planNutrition, {});

    expect(calls[0].items).toEqual([
      { recipeId: "r1", multiplier: 2.5 },
      { recipeId: "r2", multiplier: 1 },
    ]);
  });

  it("ignores entries still waiting on the unscheduled rail", async () => {
    const calls = recordRequests();
    const t = convexTest(schema, modules);
    await seed(t, [
      { recipeId: "r1", title: "Pancakes", weekday: 0 },
      { recipeId: "r2", title: "Unplanned" },
    ]);

    const result = await t.withIdentity(identity).action(api.nutrition.planNutrition, {});

    expect(calls[0].items).toEqual([{ recipeId: "r1", multiplier: 1 }]);
    expect(result.days).toHaveLength(1);
  });

  it("does not call the service at all for an unplanned week", async () => {
    const calls = recordRequests();
    const t = convexTest(schema, modules);
    await seed(t, [{ recipeId: "r1", title: "Unplanned" }]);

    const result = await t.withIdentity(identity).action(api.nutrition.planNutrition, {});

    expect(calls).toHaveLength(0);
    expect(result).toEqual({ days: [], week: null });
  });

  // recipe-service never loaded the recipe, so it has no title to report — but
  // the basket remembers it, and "Chili" beats "a removed recipe".
  it("names an uncounted recipe from the basket", async () => {
    recordRequests(({ items }) => ({
      ...emptyEstimate(),
      recipes: items.map((i) => ({
        recipeId: i.recipeId,
        title: "",
        multiplier: i.multiplier,
        counted: false,
        coverage: { resolvedMassFraction: 0, resolvedCount: 0, totalCount: 0 },
      })),
    }));
    const t = convexTest(schema, modules);
    await seed(t, [{ recipeId: "r1", title: "Chili", weekday: 0 }]);

    const result = await t.withIdentity(identity).action(api.nutrition.planNutrition, {});

    expect(result.days[0].estimate.recipes?.[0].title).toBe("Chili");
    expect(result.week?.recipes?.[0].title).toBe("Chili");
  });

  it("leaves a counted recipe's own title alone", async () => {
    recordRequests(({ items }) => ({
      ...emptyEstimate(),
      recipes: items.map((i) => ({
        recipeId: i.recipeId,
        title: "Pancakes, buttermilk",
        multiplier: i.multiplier,
        counted: true,
        coverage: { resolvedMassFraction: 1, resolvedCount: 1, totalCount: 1 },
      })),
    }));
    const t = convexTest(schema, modules);
    await seed(t, [{ recipeId: "r1", title: "Pancakes", weekday: 0 }]);

    const result = await t.withIdentity(identity).action(api.nutrition.planNutrition, {});

    expect(result.days[0].estimate.recipes?.[0].title).toBe("Pancakes, buttermilk");
  });

  it("requires authentication", async () => {
    recordRequests();
    const t = convexTest(schema, modules);
    await expect(t.action(api.nutrition.planNutrition, {})).rejects.toThrow("Not authenticated");
  });
});
