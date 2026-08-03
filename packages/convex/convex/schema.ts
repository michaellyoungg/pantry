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
  // Doubles as the week plan: an entry with a `weekday` is scheduled onto that
  // day; without one it sits unscheduled in the plan rail. All planner fields
  // are optional so pre-planner rows keep working and aggregation is unchanged.
  basket: defineTable({
    userId: v.string(),
    recipeId: v.string(),
    title: v.string(), // denormalized for display; NOT the recipe body
    // Week plan (BL-0018). weekday: 0=Mon … 6=Sun; undefined = unscheduled.
    weekday: v.optional(v.number()),
    slot: v.optional(v.string()), // "dinner" for now; other slots arrive later
    // Increment 2: servings scaling + leftovers.
    servingsMultiplier: v.optional(v.number()), // absent → treated as 1
    type: v.optional(v.union(v.literal("meal"), v.literal("leftover"))), // absent → "meal"
    // When the user marked this planned meal cooked (BL-0028). Absent = not yet
    // cooked. This timestamp IS the idempotency guard for cook-decrement: it is
    // written once, inside the same transaction that schedules the decrement, so
    // a second "mark cooked" can never step the pantry a second time.
    cookedAt: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_user_recipe", ["userId", "recipeId"]),

  // The live, reactive grocery list (aggregated lines).
  groceryList: defineTable({
    userId: v.string(),
    item: v.string(),
    // Normalized key from recipe-service; optional because rows predating
    // BL-0021 don't have it. Rows without it simply never match a pantry item.
    canonicalItem: v.optional(v.string()),
    unit: v.string(),
    quantity: v.number(),
    aisle: v.string(),
    checked: v.boolean(),
    // Set during generation when a pantry row for this canonicalItem is in
    // state "have". Purely an annotation — the line is still shown, still in
    // its original position, still checkable. Cleared per-line by needItAnyway.
    alreadyHave: v.optional(v.boolean()),
    // Approximate shelf life for this canonicalItem, looked up from
    // recipe-service during generation (BL-0029). It rides on the line because
    // check-off is a *mutation* and mutations cannot do network I/O — the
    // number has to already be in the database when the box is ticked.
    // Absent when recipe-service doesn't recognize the item.
    shelfLifeDays: v.optional(v.number()),
  }).index("by_user", ["userId"]),

  // What hardware the user owns (BL-0043). One row per owned equipment slug;
  // absence is "doesn't own it", so un-checking a box deletes the row rather
  // than storing a false — there is no third state to represent.
  //
  // Lives in Convex rather than recipe-service because it is reactive user
  // state like `basket` and `pantryItems`; the matching against recipe tags
  // still happens in recipe-service, where the recipe data is.
  //
  // `equipmentId` references recipe-service's curated catalog by slug and
  // cannot be foreign-keyed here — Convex deliberately carries no copy of the
  // catalog. A slug retired from the catalog therefore just stops matching
  // anything; the match endpoint ignores it rather than failing.
  equipmentInventory: defineTable({
    userId: v.string(),
    equipmentId: v.string(),
    // When it entered the kitchen. Drives "new to your kitchen" ordering — the
    // discovery moment is the headline experience, and it needs a recency.
    addedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_equipment", ["userId", "equipmentId"]),

  // Nutrition goals (BL-0038). One row per constraint — a macro goal is three
  // or four rows, a low-cholesterol diet is one, and a "diet preset" is just a
  // bundle of rows inserted together. There is deliberately no `lowCarbMode`
  // boolean and no per-diet column: the shape below expresses every goal the
  // product has, and every goal nobody has asked for yet.
  nutritionTargets: defineTable({
    userId: v.string(),
    // FDC nutrient number ("1003" protein, "1253" cholesterol) — the same
    // identifiers the estimate is keyed by, so evaluation is a map lookup.
    nutrientId: v.string(),
    operator: v.union(v.literal("<="), v.literal(">="), v.literal("==")),
    value: v.number(),
    period: v.union(v.literal("day"), v.literal("week"), v.literal("meal")),
    // Where the constraint came from ("Low cholesterol"), for the goal editor.
    label: v.optional(v.string()),
    // Pausing a diet must not destroy the numbers the user tuned, so `active`
    // is a flag rather than a delete.
    active: v.boolean(),
  }).index("by_user", ["userId"]),

  // Pantry (BL-0021 increment 1). Deliberately coarse: `state`, never a
  // quantity — numeric inventory drifts from reality within days. Keyed on the
  // normalized ingredient so "Green onion" and "green onions" are one row.
  pantryItems: defineTable({
    userId: v.string(),
    canonicalItem: v.string(), // "green onion"
    display: v.string(), // "Green onion"
    aisle: v.string(),
    state: v.union(v.literal("have"), v.literal("low"), v.literal("out")),
    // "auto" rows came from checking an item off the grocery list and may be
    // removed by un-checking it. "manual" rows are user-curated and never are.
    source: v.union(v.literal("auto"), v.literal("manual")),
    updatedAt: v.number(),
    // Approximate "use by" (BL-0029), stamped from the item's shelf life when
    // it entered the pantry. Optional: rows for items with no known shelf life
    // never get one, because a guessed date is worse than no date. The user is
    // never asked to type this.
    useBy: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_user_item", ["userId", "canonicalItem"]),
});
