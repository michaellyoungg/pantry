import { getAuthUserId } from "@convex-dev/auth/server";
import type { GroceryLine, NormalizationLookupResponse } from "@pantry/types";
import { type Infer, v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalMutation, mutation, query } from "./_generated/server";
import { markUseItUp, removeAutoRow, upsertFromCheckoff } from "./pantry";
import { recipeServiceFetch } from "./recipes";

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
  // What to buy, as opposed to what the recipes need (BL-0032). Optional
  // because the normalization dataset only knows how *some* items are packed.
  purchase: v.optional(
    v.object({
      quantity: v.number(),
      unit: v.string(),
      residue: v.optional(v.number()),
      residueUnit: v.optional(v.string()),
    }),
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
// Non-destructive merge — the three rules of UX-plan decision #2 (BL-0018):
//   1. preserve  — a line still in the plan keeps its `checked` state (and any
//                  needItAnyway override); only the quantity is refreshed
//   2. merge     — a line the plan newly wants is inserted, unchecked
//   3. flag      — a line the plan no longer wants is *flagged* `removed` if it
//                  was already checked off, and deleted only if it wasn't
//
// Regeneration is therefore always safe to press: nothing a shopper has done
// can be undone by it. Manual lines sit outside all three rules — see below.
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
          // Refreshed with the quantity, and for the same reason: adding a
          // recipe that wants more parsley can push the line onto a second
          // bunch, which changes both what to buy and what will be left over.
          // `leftoverDecision` is deliberately NOT cleared here — an answer the
          // user has already given is theirs to keep until they un-check the
          // line, which is the only event that means "this shop didn't happen".
          purchase: line.purchase,
          // Back in the plan, so it is no longer a leftover of an older one.
          // Clearing rather than ignoring matters: a flagged line whose recipe
          // returns must go back to being an ordinary line, tick intact.
          removed: undefined,
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
          purchase: line.purchase,
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
      // The third diff-merge rule: flag, don't destroy. Someone mid-shop who
      // has already put this in the cart must not have it vanish because the
      // plan changed on another device — they need to see that it is no longer
      // needed and decide for themselves. An unchecked line has no such
      // decision attached, so it still just goes.
      if (row.checked) {
        if (!row.removed) await ctx.db.patch(row._id, { removed: true, sources: undefined });
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
    // Stamped on every toggle, including one that lands on the value already
    // there: the stamp says "somebody spoke about this line", which is what an
    // offline device reconciling on reconnect needs to know (BL-0058). A
    // no-change write that left the stamp alone would read as silence.
    await ctx.db.patch(id, { checked, checkedAt: Date.now() });

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
      // Un-checking says the purchase didn't happen, so any answer about its
      // leftovers is about a shop that no longer exists. Clearing it puts the
      // line back in front of the user next time they do buy it.
      if (row.leftoverDecision !== undefined) {
        await ctx.db.patch(id, { leftoverDecision: undefined });
      }
    }
  },
});

// --- inferred leftovers (BL-0032) ---
//
// The residue on a checked-off line is a *guess*: we know the typical pack and
// what the recipes wanted, not what the shop actually stocked or how heavy the
// cook's hand was. So it is proposed, never asserted. Silently writing these
// into the pantry would corrupt the don't-rebuy signal BL-0021 built — the list
// would stop asking for things the user does not actually have.
//
// The confirmation tap is also the outflow signal, collected at the one moment
// the user is already thinking about that ingredient.

/**
 * Lines whose leftovers we would like to ask about: bought (checked off), with
 * a residue we can name, and not yet answered.
 *
 * `removed` lines are excluded — they were dropped from the plan, so their
 * recipes never ran and their residue describes cooking that did not happen.
 */
export const leftoverProposals = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const rows = await ctx.db
      .query("groceryList")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    return rows
      .filter(
        (row) =>
          row.checked &&
          !row.removed &&
          row.leftoverDecision === undefined &&
          row.canonicalItem !== undefined &&
          row.purchase !== undefined &&
          (row.purchase.residue ?? 0) > 0,
      )
      .map((row) => ({
        _id: row._id,
        item: row.item,
        aisle: row.aisle,
        purchase: row.purchase,
        // What the recipes wanted, so the proposal can show its own reasoning:
        // "a bunch, of which 2 tbsp got used".
        quantity: row.quantity,
        unit: row.unit,
      }));
  },
});

/**
 * The user's answer about one line's leftover. Per item, never in bulk: an
 * inferred leftover is a separate guess for each ingredient, and a single
 * "yes to all" would be the frictionless-but-wrong path this design rejects.
 *
 * `keep` writes `useItUp` through to the pantry row check-off already created.
 * The row is (re)created if it is missing, which happens when the pantry row
 * was deleted between the check-off and the answer.
 */
export const resolveLeftover = mutation({
  args: { id: v.id("groceryList"), keep: v.boolean() },
  handler: async (ctx, { id, keep }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const row = await ctx.db.get(id);
    if (row === null || row.userId !== userId) throw new Error("Not found");
    await ctx.db.patch(id, { leftoverDecision: keep ? "kept" : "dismissed" });
    if (!keep || row.canonicalItem === undefined) return;
    await markUseItUp(ctx, {
      userId,
      canonicalItem: row.canonicalItem,
      display: row.item,
      aisle: row.aisle,
    });
  },
});

// --- finishing a shop (BL-0019) ---
//
// A grocery list that is never emptied stops being a list: the next trip starts
// buried under last trip's ticks. "Done shopping" is the one moment the user
// can say which of the two halves survives, and the halves genuinely differ:
//
//   * what they bought is *finished* — and, because check-off is already the
//     pantry's inflow signal (BL-0021), it is recorded where it belongs. The
//     line itself has nothing left to say, so it always goes.
//   * what they did NOT buy is an open question. Sometimes the shop was out of
//     it and it should roll into the next trip; sometimes they decided against
//     it. Only the user knows which, so only the user gets to answer.
//
// Deliberately no pantry writes here: the inflow already happened, one row at a
// time, at the moment each box was ticked. Re-doing it at the till would double
// up on anything the user had since un-checked.
export const finishShopping = mutation({
  args: { unbought: v.union(v.literal("keep"), v.literal("remove")) },
  handler: async (ctx, { unbought }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const rows = await ctx.db
      .query("groceryList")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    let purchased = 0;
    let cleared = 0;
    for (const row of rows) {
      // A `removed` row is a flagged line the shopper had already checked off
      // (BL-0018), so it belongs to the bought half — the trip it describes is
      // the one that just ended.
      if (row.checked) {
        await ctx.db.delete(row._id);
        purchased++;
      } else if (unbought === "remove") {
        await ctx.db.delete(row._id);
        cleared++;
      }
    }
    return { purchased, cleared };
  },
});

// The shape `restoreItem` puts back. Not `groceryLineValidator`: that one is
// pinned to the @pantry/types wire contract, while this is a whole *row* minus
// its system fields and owner — the user state a delete took with it.
const restorableLineValidator = v.object({
  item: v.string(),
  canonicalItem: v.optional(v.string()),
  unit: v.string(),
  quantity: v.number(),
  aisle: v.string(),
  checked: v.boolean(),
  alreadyHave: v.optional(v.boolean()),
  shelfLifeDays: v.optional(v.number()),
  sources: v.optional(
    v.array(v.object({ recipeId: v.string(), title: v.string(), quantity: v.number() })),
  ),
  purchase: v.optional(
    v.object({
      quantity: v.number(),
      unit: v.string(),
      residue: v.optional(v.number()),
      residueUnit: v.optional(v.string()),
    }),
  ),
  leftoverDecision: v.optional(v.union(v.literal("kept"), v.literal("dismissed"))),
  manual: v.optional(v.boolean()),
  removed: v.optional(v.boolean()),
});

/**
 * Undo for a swiped-away line (BL-0019).
 *
 * The delete commits immediately and this puts the row back, rather than the
 * usual trick of holding the delete behind a timer: a shopper who swipes and
 * then locks their phone, or walks to the till and navigates away, must get the
 * outcome they asked for, and a pending-delete that lives in a component dies
 * with it. Undo is therefore a real write, replayed from the snapshot the
 * client still has on screen.
 *
 * The row comes back with a new id — nothing references a grocery line by id
 * across a delete, so that costs nothing — and re-checks the same rule
 * `removeItem` enforces, so undo can never conjure a line that could not have
 * been deleted in the first place.
 */
export const restoreItem = mutation({
  args: { line: restorableLineValidator },
  handler: async (ctx, { line }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    if (!line.manual && !line.removed) {
      throw new Error("Only manually added or removed lines can be restored");
    }
    await ctx.db.insert("groceryList", { userId, ...line });
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
    const res = await recipeServiceFetch<NormalizationLookupResponse>(
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
      (row) => row.item === line.item && row.unit === line.unit && row.aisle === line.aisle,
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

// Removing a line the user added by hand, or dismissing one the plan has
// dropped. Still deliberately not offered for a generated line that is *in* the
// plan: that one comes back on the next generation, so "remove" would be a lie
// — un-checking it is the planner's job, not the list's. A `removed` line is
// the opposite case: no recipe will ever bring it back, so the shopper is the
// only one who can clear it.
export const removeItem = mutation({
  args: { id: v.id("groceryList") },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const row = await ctx.db.get(id);
    if (row === null || row.userId !== userId) throw new Error("Not found");
    if (!row.manual && !row.removed) {
      throw new Error("Only manually added or removed lines can be removed");
    }
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
