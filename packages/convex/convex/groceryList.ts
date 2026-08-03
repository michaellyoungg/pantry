import { getAuthUserId } from "@convex-dev/auth/server";
import type { GroceryLine } from "@pantry/types";
import { type Infer, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { removeAutoRow, upsertFromCheckoff } from "./pantry";

// Single runtime source for the grocery-line shape on the Convex side. Its
// inferred type is pinned to the @pantry/types contract by the guard below, so
// the validator and the shared TS type can't silently drift.
export const groceryLineValidator = v.object({
  item: v.string(),
  canonicalItem: v.string(),
  unit: v.string(),
  quantity: v.number(),
  aisle: v.string(),
});

type Equals<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
// Fails to compile if groceryLineValidator and @pantry/types GroceryLine drift.
export const _groceryLineInSync: Equals<Infer<typeof groceryLineValidator>, GroceryLine> = true;

// Returns rows in insertion order (recipe-service pre-sorts lines by aisle
// before they're persisted). The web GroceryList relies on this ordering to
// group consecutive same-aisle lines under one header — do not add .order()
// here without updating that grouping.
export const getGroceryList = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    return await ctx.db
      .query("groceryList")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
  },
});

// Called only from the generateGroceryList action, which passes the
// authenticated userId it already resolved. Internal → not client-callable.
// Non-destructive merge: lines matching an existing row by item+unit+aisle keep
// their `checked` state (only the quantity is refreshed); new lines are
// inserted unchecked; existing rows absent from the new list are deleted. This
// preserves in-store check-off progress across re-generation (BL-0018 inc 2).
export const mergeGroceryList = internalMutation({
  args: {
    userId: v.string(),
    lines: v.array(groceryLineValidator),
    // canonicalItem -> approximate shelf life in days (BL-0029), resolved by
    // recipe-service during generation. A separate argument rather than a wider
    // line shape: `groceryLineValidator` is pinned to the @pantry/types contract
    // by the guard above, and this is Convex-internal data, not part of it.
    shelfLife: v.optional(v.record(v.string(), v.number())),
  },
  handler: async (ctx, { userId, lines, shelfLife }) => {
    const existing = await ctx.db
      .query("groceryList")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    // "Don't rebuy": items the user already owns. Only `have` counts — `low`
    // and `out` mean they still need to buy it.
    const owned = new Set(
      (
        await ctx.db
          .query("pantryItems")
          .withIndex("by_user", (q) => q.eq("userId", userId))
          .collect()
      )
        .filter((p) => p.state === "have")
        .map((p) => p.canonicalItem),
    );

    const keyOf = (l: { item: string; unit: string; aisle: string }) =>
      `${l.item} ${l.unit} ${l.aisle}`;
    const byKey = new Map(existing.map((row) => [keyOf(row), row]));
    const seen = new Set<string>();

    for (const line of lines) {
      const k = keyOf(line);
      const row = byKey.get(k);
      const shelfLifeDays = shelfLife?.[line.canonicalItem];
      if (row && !seen.has(k)) {
        // keep `checked` and any needItAnyway override; heal canonicalItem
        await ctx.db.patch(row._id, {
          quantity: line.quantity,
          canonicalItem: line.canonicalItem,
          shelfLifeDays,
        });
      } else {
        await ctx.db.insert("groceryList", {
          userId,
          item: line.item,
          canonicalItem: line.canonicalItem,
          unit: line.unit,
          quantity: line.quantity,
          aisle: line.aisle,
          checked: false,
          alreadyHave: owned.has(line.canonicalItem),
          shelfLifeDays,
        });
      }
      seen.add(k);
    }
    for (const row of existing) {
      if (!seen.has(keyOf(row))) await ctx.db.delete(row._id);
    }
  },
});

// Checking a line off is also the pantry's inflow signal (BL-0021): it records
// that the user now owns the item. Both writes happen in this one mutation, so
// they are a single transaction — a checkbox can never report success while the
// pantry write was lost.
export const toggleItem = mutation({
  args: { id: v.id("groceryList"), checked: v.boolean() },
  handler: async (ctx, { id, checked }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const row = await ctx.db.get(id);
    if (row === null || row.userId !== userId) throw new Error("Not found");
    await ctx.db.patch(id, { checked });

    // Rows predating BL-0021 have no canonical key and can't be joined to a
    // pantry item; leave the pantry untouched for them.
    if (row.canonicalItem === undefined) return;
    if (checked) {
      await upsertFromCheckoff(ctx, {
        userId,
        canonicalItem: row.canonicalItem,
        display: row.item,
        aisle: row.aisle,
        shelfLifeDays: row.shelfLifeDays,
      });
    } else {
      await removeAutoRow(ctx, { userId, canonicalItem: row.canonicalItem });
    }
  },
});

export const clearGroceryList = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const rows = await ctx.db
      .query("groceryList")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    for (const row of rows) await ctx.db.delete(row._id);
  },
});

// "I need it anyway" — the pantry thinks the user owns this, but they don't (or
// they want more). Clears the annotation for this line only; the pantry row is
// left alone, because the user is correcting the list, not the pantry.
export const needItAnyway = mutation({
  args: { id: v.id("groceryList") },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const row = await ctx.db.get(id);
    if (row === null || row.userId !== userId) throw new Error("Not found");
    await ctx.db.patch(id, { alreadyHave: false });
  },
});
