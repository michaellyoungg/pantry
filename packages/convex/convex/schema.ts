import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  ...authTables,

  // Per-user preferences (BL-0005). Ingredient-grounded fields score TODAY;
  // the facet fields are captured but inert until recipes carry metadata
  // (BL-0030), so switching them on later is a scoring change, not a migration
  // plus a re-onboarding.
  preferences: defineTable({
    userId: v.string(),
    // Ingredient-grounded — active now. avoidItems is a HARD FILTER: a recipe
    // containing one is removed, never merely down-weighted.
    avoidItems: v.array(v.string()),
    // What each avoid entry RESOLVED to, keyed by the canonicalItem stored in
    // avoidItems above (BL-0052). It is what lets the settings screen keep
    // saying "you typed scallion; this removes green onion" — and, for an entry
    // the dictionary does not recognize, "this matches nothing" — after a
    // reload, when the resolution that produced it is long gone.
    //
    // Parallel to avoidItems rather than replacing it: avoidItems is what the
    // ranker filters on and every other reader already understands, and a row
    // written before this field existed must keep working. Absent means "we
    // never recorded what this entry was", which the UI states as exactly that
    // rather than dressing up as a match.
    avoidResolutions: v.optional(
      v.array(
        v.object({
          canonicalItem: v.string(),
          input: v.string(),
          display: v.string(),
          kind: v.union(v.literal("item"), v.literal("allergen"), v.literal("unknown")),
          members: v.optional(v.array(v.string())),
        }),
      ),
    ),
    likedItems: v.array(v.string()),
    dislikedItems: v.array(v.string()),
    // Facets — captured, inert. Selecting a diet label PRE-FILLS avoidItems
    // from a curated seed set rather than filtering by inference, so nothing is
    // ever excluded invisibly.
    dietLabels: v.optional(v.array(v.string())),
    cuisines: v.optional(v.array(v.string())),
    maxMinutes: v.optional(v.number()),
    // How many people this household cooks for. Reserved by BL-0005 and made
    // real by BL-0018: it seeds the planner's servings dial, where a recipe's
    // default multiplier is household ÷ its yield, so the common case needs no
    // tapping. Optional because it is genuinely unknown until asked — a guessed
    // household would scale every grocery quantity wrong, silently.
    householdSize: v.optional(v.number()),
    updatedAt: v.number(),
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
    // Which recipes this line was aggregated from, and how much each wanted
    // (BL-0019). Denormalized onto the row for the same reason shelfLifeDays is:
    // the list is read in-store, and re-deriving provenance would mean calling
    // recipe-service on every render. Absent on manual lines and on rows
    // generated before BL-0019.
    sources: v.optional(
      v.array(v.object({ recipeId: v.string(), title: v.string(), quantity: v.number() })),
    ),
    // True for a line the user typed in themselves. It is what keeps
    // mergeGroceryList from deleting the line on the next generation: a manual
    // line has no recipe backing it, so it can never appear in an aggregated
    // result and would otherwise vanish the moment the plan changed.
    manual: v.optional(v.boolean()),
    // The plan no longer produces this line, but the shopper had already
    // checked it off (BL-0018, UX-plan decision #2: "flag removed"). Deleting
    // it would silently erase a tick — and, since check-off is also the
    // pantry's inflow signal, leave a pantry row with nothing explaining it.
    // Only ever set on checked lines: an untouched line carries no user state,
    // so the plan losing it is simply the list following the plan.
    removed: v.optional(v.boolean()),
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
    // The ONE field BL-0040 adds to this table. A hard constraint REMOVES
    // recipes from recommendations; a soft goal only reorders them. The
    // operator cannot express the difference — "<= 200 mg cholesterol" is a
    // preference for one person and a medical limit for another, and only they
    // know which. Optional so every row written before BL-0040 stays valid, and
    // so an unset flag reads as the safe default: rank, do not remove.
    hard: v.optional(v.boolean()),
  }).index("by_user", ["userId"]),

  // Prep task check-off (BL-0042). Mirrors groceryList.checked: the tasks
  // themselves are derived on demand by recipe-service and never stored here,
  // because a stored copy would freeze the rule set that produced it — the
  // whole point of rules-as-data is that improving one improves every recipe
  // that already exists. What IS user state is the tick, so that is all that
  // lives here.
  //
  // Keyed on (taskKey, cookDate), not on a recipe id: taskKey is stable across
  // re-derivation and recipe edits, and the same task for next week's dinner is
  // a genuinely different tick from this week's.
  prepTaskState: defineTable({
    userId: v.string(),
    taskKey: v.string(),
    cookDate: v.string(), // ISO date of the meal this prep is for
    done: v.boolean(),
  })
    .index("by_user", ["userId"])
    .index("by_user_task", ["userId", "taskKey", "cookDate"]),

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
    // "Things to use up" is a FLAG on the pantry row, not a second table — the
    // row already carries canonicalItem (so it joins to recipes for free),
    // display, and aisle, and it stays part of don't-rebuy.
    useItUp: v.optional(v.boolean()),
    updatedAt: v.number(),
    // Approximate "use by" (BL-0029), stamped from the item's shelf life when
    // it entered the pantry. Optional: rows for items with no known shelf life
    // never get one, because a guessed date is worse than no date. The user is
    // never asked to type this.
    useBy: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_user_item", ["userId", "canonicalItem"]),

  // Eating history (BL-0039). One row per recipe per calendar day.
  //
  // `source` is taken from the plan: a meal the user marked cooked (BL-0028's
  // `basket.cookedAt`) records as `cooked`, one merely scheduled as `planned`.
  // The upgrade is the same row and one field — no migration, no second table.
  // `manual` is reserved for a future food diary and is never written from the
  // plan.
  nutritionLog: defineTable({
    userId: v.string(),
    date: v.string(), // YYYY-MM-DD, the user's local calendar day
    recipeId: v.string(),
    // Denormalized so history stays readable after a recipe is deleted.
    title: v.optional(v.string()),
    // How many whole recipe yields were eaten; scales `snapshot.nutrients`.
    servings: v.number(),
    source: v.union(v.literal("planned"), v.literal("cooked"), v.literal("manual")),
    // The nutrient vector denormalized at log time — `NutritionLogSnapshot`.
    //
    // This is the point of the table. FDC data is refreshed and ingredient→food
    // mappings get corrected; recomputing history from current data would
    // silently rewrite what the user ate last month. History reads the snapshot
    // and never re-estimates. It carries its own coverage because otherwise a
    // day we could not identify is indistinguishable from a day of zeroes.
    //
    // `v.any()` rather than a validator: the nutrient map is deliberately open
    // (see the nutrition design), and pinning its shape here would make adding a
    // nutrient a schema migration.
    snapshot: v.any(),
    loggedAt: v.number(),
  })
    .index("by_user_date", ["userId", "date"])
    // One row per (user, day, recipe) — the key "mark cooked" will patch.
    .index("by_user_date_recipe", ["userId", "date", "recipeId"]),
});
