import { getAuthUserId } from "@convex-dev/auth/server";
import type { PrepMeal, PrepTasksResponse } from "@pantry/types";
import { v } from "convex/values";
import { api } from "./_generated/api";
import { action, mutation, query } from "./_generated/server";
import { withSpan } from "./lib/otel";
import { recipeServiceFetch } from "./recipes";

// Derived lead-time prep (BL-0042).
//
// The tasks are NOT stored: recipe-service derives them on demand from the
// versioned rule table, so improving a rule improves every recipe that already
// exists instead of needing a backfill. Convex owns exactly one thing here —
// whether the user ticked a task off — which is why the only table is
// `prepTaskState`.
//
// Every date crosses this boundary as a bare ISO string supplied by the client.
// That is deliberate: the browser knows the user's local date and the server
// does not, and a prep schedule that slips a day is worse than none at all.

/** A basket row as the prep rollup reads it. */
interface PlannedEntry {
  recipeId: string;
  title: string;
  weekday?: number;
  type?: string;
}

/**
 * Add whole days to an ISO date.
 *
 * Done in UTC on purpose. These values are calendar dates, never instants, and
 * going through local time is how "2026-11-26 plus one day" becomes the 26th
 * again in a timezone with a DST shift.
 */
function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function requireISODate(label: string, value: string): string {
  if (!ISO_DATE.test(value)) throw new Error(`${label} must be an ISO date (YYYY-MM-DD)`);
  return value;
}

/**
 * Prep for the planned week.
 *
 * `weekStart` is the Monday the planner is showing and `today` is the user's
 * local date; the basket only stores a weekday (0=Mon … 6=Sun), so the concrete
 * cook date is weekStart + weekday. Without that resolution there is no lead
 * time to compute and the feature does not exist.
 *
 * Leftovers are excluded: reheating Sunday's roast needs no thaw, and the meal
 * that produced it already carried the prep.
 */
export const forPlan = action({
  args: {
    weekStart: v.string(),
    today: v.string(),
    traceCtx: v.optional(v.string()),
  },
  handler: async (ctx, { weekStart, today, traceCtx }): Promise<PrepTasksResponse> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    requireISODate("weekStart", weekStart);
    requireISODate("today", today);

    return withSpan("prepTasks.forPlan", traceCtx, async (traceparent) => {
      const basket: PlannedEntry[] = await ctx.runQuery(api.basket.list, {});
      const meals = basket
        .filter(
          (b): b is PlannedEntry & { weekday: number } =>
            Number.isInteger(b.weekday) && b.type !== "leftover",
        )
        .map((b) => ({ recipeId: b.recipeId, cookDate: addDays(weekStart, b.weekday) }));

      if (meals.length === 0) return { rulesVersion: "", meals: [] };

      return recipeServiceFetch<PrepTasksResponse>(
        userId,
        "POST",
        "/prep-tasks",
        { meals, today },
        traceparent,
      );
    });
  },
});

/**
 * Prep for one recipe, for the "before you start" list on recipe detail.
 *
 * A recipe on its own has no cook date, so the caller passes one (today) and
 * the surface renders the *windows* rather than the dates — "the night before"
 * is the useful fact when you are reading a recipe you have not scheduled.
 */
export const forRecipe = action({
  args: {
    recipeId: v.string(),
    cookDate: v.string(),
    traceCtx: v.optional(v.string()),
  },
  handler: async (ctx, { recipeId, cookDate, traceCtx }): Promise<PrepMeal | null> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    requireISODate("cookDate", cookDate);

    return withSpan("prepTasks.forRecipe", traceCtx, async (traceparent) => {
      const res = await recipeServiceFetch<PrepTasksResponse>(
        userId,
        "POST",
        "/prep-tasks",
        { meals: [{ recipeId, cookDate }] },
        traceparent,
      );
      return res.meals[0] ?? null;
    });
  },
});

/** One stored tick. */
export interface PrepTaskState {
  taskKey: string;
  cookDate: string;
  done: boolean;
}

/**
 * The user's check-off state.
 *
 * A reactive query rather than part of the action's payload, so ticking a box
 * updates instantly instead of re-deriving the whole week over the network.
 * Only `done` rows are returned — an unticked task simply has no row.
 */
export const states = query({
  args: {},
  handler: async (ctx): Promise<PrepTaskState[]> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    const rows = await ctx.db
      .query("prepTaskState")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    return rows.map((r) => ({ taskKey: r.taskKey, cookDate: r.cookDate, done: r.done }));
  },
});

/**
 * Tick or untick one task for one meal date.
 *
 * Upsert on (taskKey, cookDate): re-deriving the week must land on the same row
 * it did last time, which is exactly what the stable key buys.
 */
export const setDone = mutation({
  args: {
    taskKey: v.string(),
    cookDate: v.string(),
    done: v.boolean(),
  },
  handler: async (ctx, { taskKey, cookDate, done }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    requireISODate("cookDate", cookDate);

    const existing = await ctx.db
      .query("prepTaskState")
      .withIndex("by_user_task", (q) =>
        q.eq("userId", userId).eq("taskKey", taskKey).eq("cookDate", cookDate),
      )
      .unique();

    if (existing === null) {
      // Nothing to record for an untick with no row — the absence of a row is
      // already "not done", and inserting `false` would grow a table of
      // negatives that means the same as empty.
      if (!done) return;
      await ctx.db.insert("prepTaskState", { userId, taskKey, cookDate, done });
      return;
    }
    if (done) {
      await ctx.db.patch(existing._id, { done });
    } else {
      await ctx.db.delete(existing._id);
    }
  },
});
