import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { type MutationCtx, mutation, query } from "./_generated/server";

/**
 * Nutrition goals (BL-0038).
 *
 * Every goal in the product is one row of `{nutrientId, operator, value,
 * period}`. A macro goal is three or four rows; a low-cholesterol diet is one.
 * Nothing in this file knows what a "diet" is — `applyPreset` takes rows, not a
 * preset name, so presets stay data and a new one needs no code here.
 *
 * The evaluation itself lives in `@pantry/core`, not in Convex: it is pure
 * arithmetic over a summed vector and belongs where every client can reuse it.
 */

export const operatorValidator = v.union(v.literal("<="), v.literal(">="), v.literal("=="));
export const periodValidator = v.union(v.literal("day"), v.literal("week"), v.literal("meal"));

/** The user-supplied half of a target row; `userId` and `active` are ours. */
const targetInput = {
  nutrientId: v.string(),
  operator: operatorValidator,
  value: v.number(),
  period: periodValidator,
  label: v.optional(v.string()),
  // BL-0040: whether breaking this goal disqualifies a recipe outright.
  hard: v.optional(v.boolean()),
};

type TargetInput = {
  nutrientId: string;
  operator: Doc<"nutritionTargets">["operator"];
  value: number;
  period: Doc<"nutritionTargets">["period"];
  label?: string;
  hard?: boolean;
};

async function requireUser(ctx: { auth: MutationCtx["auth"] }): Promise<string> {
  const userId = await getAuthUserId(ctx as Parameters<typeof getAuthUserId>[0]);
  if (userId === null) throw new Error("Not authenticated");
  return userId;
}

/**
 * A goal is only meaningful as a finite, non-negative amount. Rejecting here
 * rather than in the UI keeps a bad number out of the evaluator, where it would
 * produce a confidently wrong verdict rather than an error.
 */
function assertValue(value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("Target value must be a finite, non-negative number");
  }
}

/**
 * Write one constraint, replacing any existing constraint on the same nutrient
 * in the same period.
 *
 * Two rules for one nutrient in one window is not a goal — it is a contradiction
 * the user has no way to see or resolve. Re-setting it re-tunes the number, and
 * re-setting a paused goal resumes it, because that is what the user asking for
 * it again means.
 */
async function upsert(
  ctx: MutationCtx,
  userId: string,
  input: TargetInput,
): Promise<Id<"nutritionTargets">> {
  assertValue(input.value);
  const existing = await ctx.db
    .query("nutritionTargets")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .filter((q) =>
      q.and(q.eq(q.field("nutrientId"), input.nutrientId), q.eq(q.field("period"), input.period)),
    )
    .first();

  if (existing) {
    // `hard` survives an unmentioning re-set. Re-tuning the number on a
    // constraint the user marked as hard must not quietly demote it to a
    // suggestion — a patch with an absent field would delete it.
    await ctx.db.patch(existing._id, {
      ...input,
      hard: input.hard ?? existing.hard,
      active: true,
    });
    return existing._id;
  }
  return await ctx.db.insert("nutritionTargets", { userId, ...input, active: true });
}

/** Load a row and prove it belongs to the caller. */
async function ownedTarget(
  ctx: MutationCtx,
  userId: string,
  id: Id<"nutritionTargets">,
): Promise<Doc<"nutritionTargets">> {
  const row = await ctx.db.get(id);
  // Deliberately the same message for "gone" and "someone else's": a distinct
  // error would confirm the row exists to a user who may not touch it.
  if (!row || row.userId !== userId) throw new Error("Target not found");
  return row;
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    return await ctx.db
      .query("nutritionTargets")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
  },
});

export const add = mutation({
  args: targetInput,
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    return await upsert(ctx, userId, args);
  },
});

export const setActive = mutation({
  args: { id: v.id("nutritionTargets"), active: v.boolean() },
  handler: async (ctx, { id, active }) => {
    const userId = await requireUser(ctx);
    await ownedTarget(ctx, userId, id);
    await ctx.db.patch(id, { active });
  },
});

/**
 * Promote a goal to a hard constraint, or demote it back to a preference.
 *
 * Separate from `add` because it is a different decision: `add` is about the
 * number, this is about what breaking it means. Keeping them apart is also what
 * lets the goal editor offer it as a toggle on an existing row rather than
 * making the user re-enter a target to change its severity.
 */
export const setHard = mutation({
  args: { id: v.id("nutritionTargets"), hard: v.boolean() },
  handler: async (ctx, { id, hard }) => {
    const userId = await requireUser(ctx);
    await ownedTarget(ctx, userId, id);
    await ctx.db.patch(id, { hard });
  },
});

export const remove = mutation({
  args: { id: v.id("nutritionTargets") },
  handler: async (ctx, { id }) => {
    const userId = await requireUser(ctx);
    await ownedTarget(ctx, userId, id);
    await ctx.db.delete(id);
  },
});

/**
 * Apply a bundle of constraints in one go — what a "diet preset" actually is.
 *
 * It takes rows rather than a preset id on purpose. The preset table lives in
 * `@pantry/core` as data today and could be served from anywhere tomorrow;
 * either way it arrives here as the same argument, so this mutation never grows
 * a branch per diet. Goals the bundle does not mention are left alone, because
 * choosing "low carb" is not a statement about your protein goal.
 */
export const applyPreset = mutation({
  args: { targets: v.array(v.object(targetInput)) },
  handler: async (ctx, { targets }) => {
    const userId = await requireUser(ctx);
    if (targets.length === 0) throw new Error("Preset has no targets");
    for (const target of targets) {
      await upsert(ctx, userId, target);
    }
  },
});
