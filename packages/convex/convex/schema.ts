import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  ...authTables,

  // Per-user preferences placeholder (populated later).
  preferences: defineTable({
    userId: v.string(),
    // freeform for now; real fields arrive with the recommendations work.
    data: v.optional(v.any()),
  }).index("by_user", ["userId"]),

  // "What I'm cooking" — references to recipe ids owned by recipe-service.
  // Plan entries — "what I'm cooking, and when". References recipe ids owned by
  // recipe-service; a recipe may appear more than once (planned on many days).
  basket: defineTable({
    userId: v.string(),
    recipeId: v.string(),
    title: v.string(), // denormalized for display; NOT the recipe body
    plannedDate: v.optional(v.string()), // "YYYY-MM-DD"; absent = unscheduled
    servingsMultiplier: v.optional(v.number()), // absent → treated as 1
    type: v.optional(v.union(v.literal("meal"), v.literal("leftover"))), // absent → "meal"
  })
    .index("by_user", ["userId"])
    .index("by_user_recipe", ["userId", "recipeId"]),

  // The live, reactive grocery list (aggregated lines).
  groceryList: defineTable({
    userId: v.string(),
    item: v.string(),
    unit: v.string(),
    quantity: v.number(),
    aisle: v.string(),
    checked: v.boolean(),
  }).index("by_user", ["userId"]),
});
