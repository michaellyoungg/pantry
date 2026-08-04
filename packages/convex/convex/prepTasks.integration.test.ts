import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// Cross-service contract for derived prep (BL-0042). The Convex action makes a
// REAL HTTP call to a running recipe-service — no fetch mock — so this covers
// the seam neither side's unit tests can: the request path, the headers, and
// the fact that both ends agree on what a PrepTask looks like on the wire.
//
// It also pins the one piece of behaviour that is genuinely split across the
// two services: Convex resolves a basket weekday into a cook date, and Go
// derives the lead time backwards from it. Either half alone proves nothing
// about whether a thaw lands on the right day.
//
// Run via `pnpm --filter @pantry/convex test:integration`, NOT `pnpm test`.

const modules = import.meta.glob("./**/*.*s");

const identity = { subject: "prep-integration-user|session" };

function client() {
  return convexTest(schema, modules).withIdentity(identity);
}

describe("prepTasks <-> recipe-service contract", () => {
  let created: string[] = [];

  beforeEach(() => {
    created = [];
  });

  afterEach(async () => {
    const t = client();
    for (const id of created) {
      try {
        await t.action(api.recipes.remove, { id });
      } catch {
        // already gone — ignore
      }
    }
  });

  it("derives a thaw against the planned cook date, not today", async () => {
    const t = client();
    const recipe = await t.action(api.recipes.create, {
      title: "Integration Roast",
      ingredients: [{ quantity: 12, unit: "lb", item: "frozen turkey" }],
    });
    created.push(recipe.id);

    await t.mutation(api.basket.add, { recipeId: recipe.id, title: recipe.title });
    // Thursday (0=Mon … 6=Sun) of the week starting Mon 3 Aug 2026 → 6 Aug.
    await t.mutation(api.basket.schedule, { recipeId: recipe.id, weekday: 3 });

    const res = await t.action(api.prepTasks.forPlan, {
      weekStart: "2026-08-03",
      today: "2026-08-03",
    });

    expect(res.rulesVersion).toBeTruthy();
    expect(res.meals).toHaveLength(1);
    const meal = res.meals[0];
    expect(meal).toMatchObject({ recipeId: recipe.id, title: "Integration Roast" });
    expect(meal.cookDate).toBe("2026-08-06");

    const thaw = meal.tasks.find((task) => task.ruleId === "thaw_frozen_large_roast");
    expect(thaw).toBeDefined();
    // Three days of lead time, counted back from the COOK date. This is the
    // whole feature: computed against today it would say 2026-07-31.
    expect(thaw?.dueOn).toBe("2026-08-03");
    expect(thaw?.window).toBe("three_days_before");
    expect(thaw?.source).toBe("rule");
    expect(thaw?.key).toBe("thaw_frozen_large_roast:turkey");
    expect(thaw?.missed).toBeFalsy();
  });

  // A window that has already passed must come back flagged, never omitted.
  it("marks a passed window missed rather than dropping it", async () => {
    const t = client();
    const recipe = await t.action(api.recipes.create, {
      title: "Integration Late Roast",
      ingredients: [{ quantity: 12, unit: "lb", item: "frozen turkey" }],
    });
    created.push(recipe.id);

    await t.mutation(api.basket.add, { recipeId: recipe.id, title: recipe.title });
    await t.mutation(api.basket.schedule, { recipeId: recipe.id, weekday: 3 });

    // Asking on the cook date itself: the three-day thaw is long gone.
    const res = await t.action(api.prepTasks.forPlan, {
      weekStart: "2026-08-03",
      today: "2026-08-06",
    });

    const thaw = res.meals[0].tasks.find((task) => task.ruleId === "thaw_frozen_large_roast");
    expect(thaw).toBeDefined();
    expect(thaw?.missed).toBe(true);
  });

  // The key the service mints is the key check-off is stored against. If the
  // two ever disagree, a tick silently applies to nothing.
  it("check-off is keyed on the key the service returned", async () => {
    const t = client();
    const recipe = await t.action(api.recipes.create, {
      title: "Integration Butter Cake",
      ingredients: [{ quantity: 1, unit: "cup", item: "unsalted butter", note: "softened" }],
      methods: ["bake"],
    });
    created.push(recipe.id);

    await t.mutation(api.basket.add, { recipeId: recipe.id, title: recipe.title });
    await t.mutation(api.basket.schedule, { recipeId: recipe.id, weekday: 0 });

    const res = await t.action(api.prepTasks.forPlan, {
      weekStart: "2026-08-03",
      today: "2026-08-03",
    });
    const meal = res.meals[0];
    const soften = meal.tasks.find((task) => task.ruleId === "soften_butter");
    expect(soften).toBeDefined();

    await t.mutation(api.prepTasks.setDone, {
      taskKey: soften?.key ?? "",
      cookDate: meal.cookDate,
      done: true,
    });

    expect(await t.query(api.prepTasks.states, {})).toEqual([
      { taskKey: soften?.key, cookDate: meal.cookDate, done: true },
    ]);

    // Re-deriving must land on the same key, or the tick is orphaned.
    const again = await t.action(api.prepTasks.forPlan, {
      weekStart: "2026-08-03",
      today: "2026-08-03",
    });
    const softenAgain = again.meals[0].tasks.find((task) => task.ruleId === "soften_butter");
    expect(softenAgain?.key).toBe(soften?.key);
  });

  it("a recipe with nothing to derive returns an empty task list", async () => {
    const t = client();
    const recipe = await t.action(api.recipes.create, {
      title: "Integration Salad",
      ingredients: [{ quantity: 1, unit: "", item: "lettuce" }],
    });
    created.push(recipe.id);

    await t.mutation(api.basket.add, { recipeId: recipe.id, title: recipe.title });
    await t.mutation(api.basket.schedule, { recipeId: recipe.id, weekday: 1 });

    const res = await t.action(api.prepTasks.forPlan, {
      weekStart: "2026-08-03",
      today: "2026-08-03",
    });
    expect(res.meals[0].tasks).toEqual([]);
  });
});
