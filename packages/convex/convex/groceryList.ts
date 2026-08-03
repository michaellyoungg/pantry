import { getAuthUserId } from "@convex-dev/auth/server";
import type { GroceryLine } from "@pantry/types";
import { type Infer, v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalMutation, mutation, query } from "./_generated/server";
import { removeAutoRow, upsertFromCheckoff } from "./pantry";
import { type NormalizedItem, recipeServiceFetch } from "./recipes";

// How many "recent" chips the manual-add field offers. Enough to be useful on a
// phone without turning the add field into a second list to read.
const RECENT_SUGGESTION_LIMIT = 8;

// Single runtime source for the grocery-line shape on the Convex side. Its
// inferred type is pinned to the @pantry/types contract by the guard below, so
// the validator and the shared TS type can't silently drift.
export const groceryLineValidator = v.object({
  item: v.string(),
  canonicalItem: v.string(),
  unit: v.string(),
  quantity: v.number(),
  aisle: v.string(),
  // Which recipes the line was aggregated from (BL-0019). Optional on the wire
  // because a line can legitimately have no traceable source — see
  // GroceryLineSource in @pantry/types.
  sources: v.optional(
    v.array(v.object({ recipeId: v.string(), title: v.string(), quantity: v.number() })),
  ),
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
        // `manual` is deliberately left as-is: if the user typed this line in
        // and the plan later grew a recipe wanting the same thing, they still
        // asked for it, so it stays protected from the sweep below.
        await ctx.db.patch(row._id, {
          quantity: line.quantity,
          canonicalItem: line.canonicalItem,
          shelfLifeDays,
          sources: line.sources,
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
          sources: line.sources,
        });
      }
      seen.add(k);
    }
    for (const row of existing) {
      if (seen.has(keyOf(row))) continue;
      // A manual line has no recipe behind it, so it can never appear in an
      // aggregated result — deleting it here would silently erase what the user
      // typed every time the plan changed. Keep it, but drop provenance it may
      // have picked up from a recipe that has since left the plan.
      if (row.manual) {
        if (row.sources !== undefined) await ctx.db.patch(row._id, { sources: undefined });
        continue;
      }
      await ctx.db.delete(row._id);
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

// A line the user typed in themselves. Categorising it is the whole trick: the
// canonical item + aisle come from recipe-service's normalization table, which
// is also what the aggregator uses, so a manual "scallions" lands in the same
// aisle — and joins the same pantry row — as a recipe's "green onion".
//
// This has to be an action: mutations cannot do network I/O, and the
// normalization table deliberately lives in one place (recipe-service) rather
// than being duplicated into Convex where it would drift.
export const addManualItem = action({
  args: {
    item: v.string(),
    quantity: v.number(),
    unit: v.string(),
  },
  handler: async (ctx, { item, quantity, unit }): Promise<null> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const text = item.trim();
    if (text === "") throw new Error("Item is required");

    // Unknown items still normalize — they pass through lowercased and land in
    // the catch-all aisle — so a miss here means the service call itself failed.
    const res = await recipeServiceFetch<{ items: NormalizedItem[] }>(
      userId,
      "POST",
      "/normalization/lookup",
      { items: [text] },
    );
    const details = res.items?.[0];

    await ctx.runMutation(internal.groceryList.insertManualLine, {
      userId,
      item: details?.display ?? text,
      canonicalItem: details?.canonicalItem ?? text.toLowerCase(),
      aisle: details?.aisle ?? "other",
      shelfLifeDays: details?.shelfLifeDays,
      quantity: quantity > 0 ? quantity : 1,
      unit: unit.trim(),
    });
    return null;
  },
});

// Called only from addManualItem, which has already resolved the aisle.
// Adding something already on the list adds to that line rather than opening a
// second one — the list's whole promise is one line per thing to buy.
export const insertManualLine = internalMutation({
  args: {
    userId: v.string(),
    item: v.string(),
    canonicalItem: v.string(),
    unit: v.string(),
    quantity: v.number(),
    aisle: v.string(),
    shelfLifeDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { userId, ...line } = args;
    const existing = await ctx.db
      .query("groceryList")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const match = existing.find(
      (row) =>
        row.item === line.item && row.unit === line.unit && row.aisle === line.aisle,
    );
    if (match) {
      await ctx.db.patch(match._id, {
        quantity: match.quantity + line.quantity,
        // Re-adding something you already checked off means you want more of it,
        // so the line comes back to the "still to buy" half of the list.
        checked: false,
        manual: true,
      });
      return;
    }
    await ctx.db.insert("groceryList", { userId, ...line, checked: false, manual: true });
  },
});

// Removing a line the user added by hand. Deliberately not offered for
// generated lines: those come back on the next generation, so "remove" would be
// a lie. Un-checking a recipe-backed line is the planner's job, not the list's.
export const removeItem = mutation({
  args: { id: v.id("groceryList") },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const row = await ctx.db.get(id);
    if (row === null || row.userId !== userId) throw new Error("Not found");
    if (!row.manual) throw new Error("Only manually added lines can be removed");
    await ctx.db.delete(id);
  },
});

// Suggestions for the manual-add field. The pantry is already a record of what
// this household buys (check-off writes to it), so "recent" needs no new table
// and no history of its own — it is the same normalized item identity the rest
// of the loop uses. Items already on the list are filtered out: suggesting
// something you are about to buy anyway is noise.
export const recentItems = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const onList = new Set(
      (
        await ctx.db
          .query("groceryList")
          .withIndex("by_user", (q) => q.eq("userId", userId))
          .collect()
      )
        .map((row) => row.canonicalItem)
        .filter((c): c is string => c !== undefined),
    );
    return (
      await ctx.db
        .query("pantryItems")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect()
    )
      .filter((row) => !onList.has(row.canonicalItem))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, RECENT_SUGGESTION_LIMIT)
      .map((row) => ({ canonicalItem: row.canonicalItem, display: row.display }));
  },
});
