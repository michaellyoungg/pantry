import type { PrepTasksResponse } from "@pantry/types";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// The Convex side of derived prep (BL-0042). recipe-service is stubbed: the
// derivation itself is tested in Go. What needs pinning here is the boundary —
// which basket rows become which (recipeId, cookDate) pairs, and that check-off
// is keyed so it survives re-derivation.
const modules = import.meta.glob("./**/*.*s");

const identity = { subject: "user-a|session" };

interface Recorded {
  path: string;
  meals: Array<{ recipeId: string; cookDate: string }>;
  today?: string;
}

function emptyResponse(): PrepTasksResponse {
  return { rulesVersion: "test.1", meals: [] };
}

/** Stubs recipe-service and records the request bodies it was sent. */
function recordRequests(reply: (body: Recorded) => PrepTasksResponse = emptyResponse) {
  const calls: Recorded[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const parsed = JSON.parse(String(init.body));
      const recorded: Recorded = {
        path: new URL(url).pathname,
        meals: parsed.meals,
        today: parsed.today,
      };
      calls.push(recorded);
      return new Response(JSON.stringify(reply(recorded)), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
  return calls;
}

async function seed(
  t: ReturnType<typeof convexTest>,
  rows: Array<{ recipeId: string; title: string; weekday?: number; type?: "meal" | "leftover" }>,
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

describe("prepTasks.forPlan", () => {
  // The basket stores a weekday, not a date. Resolving it against the week the
  // planner is showing is the entire reason lead time can be computed at all.
  it("resolves each planned weekday to a concrete cook date", async () => {
    const calls = recordRequests();
    const t = convexTest(schema, modules);
    await seed(t, [
      { recipeId: "r1", title: "Pancakes", weekday: 0 },
      { recipeId: "r2", title: "Chili", weekday: 3 },
    ]);

    await t
      .withIdentity(identity)
      .action(api.prepTasks.forPlan, { weekStart: "2026-08-03", today: "2026-08-03" });

    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe("/prep-tasks");
    expect(calls[0].meals).toEqual([
      { recipeId: "r1", cookDate: "2026-08-03" },
      { recipeId: "r2", cookDate: "2026-08-06" },
    ]);
    // `today` rides along so the service can mark a passed window missed.
    expect(calls[0].today).toBe("2026-08-03");
  });

  it("carries a cook date across a month boundary", async () => {
    const calls = recordRequests();
    const t = convexTest(schema, modules);
    await seed(t, [{ recipeId: "r1", title: "Roast", weekday: 6 }]);

    await t
      .withIdentity(identity)
      .action(api.prepTasks.forPlan, { weekStart: "2026-08-31", today: "2026-08-31" });

    expect(calls[0].meals).toEqual([{ recipeId: "r1", cookDate: "2026-09-06" }]);
  });

  // Reheating Sunday's roast needs no thaw; the meal that produced it already
  // carried the prep.
  it("excludes leftovers and unscheduled rail entries", async () => {
    const calls = recordRequests();
    const t = convexTest(schema, modules);
    await seed(t, [
      { recipeId: "r1", title: "Chili", weekday: 0, type: "meal" },
      { recipeId: "r2", title: "Chili again", weekday: 1, type: "leftover" },
      { recipeId: "r3", title: "Unplanned" },
    ]);

    await t
      .withIdentity(identity)
      .action(api.prepTasks.forPlan, { weekStart: "2026-08-03", today: "2026-08-03" });

    expect(calls[0].meals).toEqual([{ recipeId: "r1", cookDate: "2026-08-03" }]);
  });

  it("does not call recipe-service for an empty week", async () => {
    const calls = recordRequests();
    const t = convexTest(schema, modules);

    const res = await t
      .withIdentity(identity)
      .action(api.prepTasks.forPlan, { weekStart: "2026-08-03", today: "2026-08-03" });

    expect(calls).toHaveLength(0);
    expect(res.meals).toEqual([]);
  });

  it("rejects a malformed date rather than sending it on", async () => {
    const calls = recordRequests();
    const t = convexTest(schema, modules);
    await seed(t, [{ recipeId: "r1", title: "Chili", weekday: 0 }]);

    await expect(
      t
        .withIdentity(identity)
        .action(api.prepTasks.forPlan, { weekStart: "03/08/2026", today: "2026-08-03" }),
    ).rejects.toThrow(/ISO date/);
    expect(calls).toHaveLength(0);
  });

  it("requires authentication", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.action(api.prepTasks.forPlan, { weekStart: "2026-08-03", today: "2026-08-03" }),
    ).rejects.toThrow(/Not authenticated/);
  });
});

describe("prepTasks.forRecipe", () => {
  it("returns the single meal's tasks", async () => {
    recordRequests(() => ({
      rulesVersion: "test.1",
      meals: [
        {
          recipeId: "r1",
          title: "Roast turkey",
          cookDate: "2026-08-03",
          tasks: [
            {
              key: "thaw_frozen_protein:turkey",
              ruleId: "thaw_frozen_protein",
              subject: "turkey",
              window: "night_before",
              text: "Move the turkey to the fridge to thaw",
              source: "rule",
              dueOn: "2026-08-02",
            },
          ],
        },
      ],
    }));
    const t = convexTest(schema, modules);

    const meal = await t
      .withIdentity(identity)
      .action(api.prepTasks.forRecipe, { recipeId: "r1", cookDate: "2026-08-03" });

    expect(meal?.tasks).toHaveLength(1);
    expect(meal?.tasks[0].window).toBe("night_before");
  });

  it("returns null when the recipe derived nothing", async () => {
    recordRequests();
    const t = convexTest(schema, modules);

    const meal = await t
      .withIdentity(identity)
      .action(api.prepTasks.forRecipe, { recipeId: "r1", cookDate: "2026-08-03" });

    expect(meal).toBeNull();
  });
});

describe("prepTasks check-off", () => {
  const key = "thaw_frozen_protein:turkey";

  it("records a tick and reads it back", async () => {
    const t = convexTest(schema, modules);
    const as = t.withIdentity(identity);

    await as.mutation(api.prepTasks.setDone, { taskKey: key, cookDate: "2026-08-05", done: true });

    expect(await as.query(api.prepTasks.states, {})).toEqual([
      { taskKey: key, cookDate: "2026-08-05", done: true },
    ]);
  });

  // The same task for two different dinners is two independent ticks: last
  // week's thaw being done says nothing about next week's.
  it("scopes a tick to its cook date", async () => {
    const t = convexTest(schema, modules);
    const as = t.withIdentity(identity);

    await as.mutation(api.prepTasks.setDone, { taskKey: key, cookDate: "2026-08-05", done: true });
    await as.mutation(api.prepTasks.setDone, { taskKey: key, cookDate: "2026-08-12", done: true });

    const states = await as.query(api.prepTasks.states, {});
    expect(states.map((s) => s.cookDate).sort()).toEqual(["2026-08-05", "2026-08-12"]);
  });

  it("ticking twice does not duplicate the row", async () => {
    const t = convexTest(schema, modules);
    const as = t.withIdentity(identity);

    await as.mutation(api.prepTasks.setDone, { taskKey: key, cookDate: "2026-08-05", done: true });
    await as.mutation(api.prepTasks.setDone, { taskKey: key, cookDate: "2026-08-05", done: true });

    expect(await as.query(api.prepTasks.states, {})).toHaveLength(1);
  });

  it("unticking clears the row, and unticking nothing is a no-op", async () => {
    const t = convexTest(schema, modules);
    const as = t.withIdentity(identity);

    await as.mutation(api.prepTasks.setDone, { taskKey: key, cookDate: "2026-08-05", done: false });
    expect(await as.query(api.prepTasks.states, {})).toEqual([]);

    await as.mutation(api.prepTasks.setDone, { taskKey: key, cookDate: "2026-08-05", done: true });
    await as.mutation(api.prepTasks.setDone, { taskKey: key, cookDate: "2026-08-05", done: false });
    expect(await as.query(api.prepTasks.states, {})).toEqual([]);
  });

  it("never returns another user's ticks", async () => {
    const t = convexTest(schema, modules);
    await t
      .withIdentity({ subject: "someone-else|session" })
      .mutation(api.prepTasks.setDone, { taskKey: key, cookDate: "2026-08-05", done: true });

    expect(await t.withIdentity(identity).query(api.prepTasks.states, {})).toEqual([]);
  });

  it("signed out reads no state and cannot write", async () => {
    const t = convexTest(schema, modules);
    expect(await t.query(api.prepTasks.states, {})).toEqual([]);
    await expect(
      t.mutation(api.prepTasks.setDone, { taskKey: key, cookDate: "2026-08-05", done: true }),
    ).rejects.toThrow(/Not authenticated/);
  });
});
