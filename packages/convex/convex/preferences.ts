import { getAuthUserId } from "@convex-dev/auth/server";
import type { AvoidResolution } from "@pantry/types";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalMutation, mutation, query } from "./_generated/server";

/**
 * Lowercases, trims and de-duplicates stored ingredient keys.
 *
 * This is NOT canonicalization. Go's Normalizer resolves a synonym table, folds
 * plurals and strips modifiers, and `containsAvoided` in the recommend package
 * matches on the keys it produces — so an entry that merely got lowercased here
 * ("scallion") matches no canonical item at all ("green onion") and silently
 * filters nothing.
 *
 * Real canonicalization needs the dictionary, which lives in recipe-service and
 * is reachable only over HTTP, which a mutation cannot do. It therefore happens
 * in `addAvoidItems` (an action) BEFORE anything is stored. This function
 * remains the last-resort tidy-up for the paths that write list fields without
 * resolving them — `set` — and for likes/dislikes, which are ranking weights
 * rather than a hard filter and so degrade rather than fail when they miss.
 */
const canonicalize = (items: string[] | undefined): string[] =>
  Array.from(new Set((items ?? []).map((s) => s.trim().toLowerCase()).filter(Boolean)));

/** A stored avoid resolution: the wire shape minus the fields nothing reads back. */
type StoredAvoidResolution = {
  canonicalItem: string;
  input: string;
  display: string;
  kind: "item" | "allergen" | "unknown";
  members?: string[];
};

const EMPTY = {
  avoidItems: [] as string[],
  avoidResolutions: [] as StoredAvoidResolution[],
  likedItems: [] as string[],
  dislikedItems: [] as string[],
  dietLabels: [] as string[],
  cuisines: [] as string[],
  maxMinutes: undefined as number | undefined,
  householdSize: undefined as number | undefined,
};

export const get = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const row = await ctx.db
      .query("preferences")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    // Absent preferences are not an error — a user who has never opened
    // settings still gets recommendations, just without preference signal.
    if (row === null) return EMPTY;
    return {
      avoidItems: row.avoidItems,
      // Pruned to the entries that are actually stored, so a resolution can
      // never outlive the item it describes and label some other entry.
      avoidResolutions: (row.avoidResolutions ?? []).filter((r) =>
        row.avoidItems.includes(r.canonicalItem),
      ),
      likedItems: row.likedItems,
      dislikedItems: row.dislikedItems,
      dietLabels: row.dietLabels ?? [],
      cuisines: row.cuisines ?? [],
      maxMinutes: row.maxMinutes,
      householdSize: row.householdSize,
    };
  },
});

export const set = mutation({
  args: {
    avoidItems: v.optional(v.array(v.string())),
    likedItems: v.optional(v.array(v.string())),
    dislikedItems: v.optional(v.array(v.string())),
    dietLabels: v.optional(v.array(v.string())),
    cuisines: v.optional(v.array(v.string())),
    maxMinutes: v.optional(v.number()),
    householdSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");

    const existing = await ctx.db
      .query("preferences")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();

    const avoidItems = canonicalize(args.avoidItems ?? existing?.avoidItems);
    const next = {
      userId,
      avoidItems,
      // Carried forward explicitly, and pruned to the surviving entries. A patch
      // that simply omitted this field would DELETE it (Convex treats an absent
      // optional as a clear), so writing an unrelated preference would wipe
      // every resolution; and keeping a resolution whose entry has gone would
      // mislabel a later entry that happens to reuse the key.
      avoidResolutions: (existing?.avoidResolutions ?? []).filter((r) =>
        avoidItems.includes(r.canonicalItem),
      ),
      likedItems: canonicalize(args.likedItems ?? existing?.likedItems),
      dislikedItems: canonicalize(args.dislikedItems ?? existing?.dislikedItems),
      dietLabels: args.dietLabels ?? existing?.dietLabels,
      cuisines: args.cuisines ?? existing?.cuisines,
      // 0 is an explicit CLEAR, not a limit (BL-0030).
      //
      // Every other field here merges on omission, which leaves an optional
      // preference settable but never unsettable — a cook who said "under 30
      // minutes" and stopped caring would be stuck with it forever. 0 is safe to
      // spend on this because it is not a limit any recipe could satisfy, and
      // the ranker independently treats a non-positive limit as no preference.
      maxMinutes: args.maxMinutes === 0 ? undefined : (args.maxMinutes ?? existing?.maxMinutes),
      householdSize: args.householdSize ?? existing?.householdSize,
      updatedAt: Date.now(),
    };

    if (existing === null) await ctx.db.insert("preferences", next);
    else await ctx.db.patch(existing._id, next);
  },
});

// How long we wait on recipe-service before giving up resolving an entry.
// Deliberately short: this runs while someone is looking at a text field.
const RESOLVE_TIMEOUT_MS = 5_000;

const avoidResolutionValidator = v.object({
  canonicalItem: v.string(),
  input: v.string(),
  display: v.string(),
  kind: v.union(v.literal("item"), v.literal("allergen"), v.literal("unknown")),
  members: v.optional(v.array(v.string())),
});

/**
 * Add avoid-list entries, canonicalized through the ingredient dictionary
 * (BL-0052).
 *
 * This is an ACTION because canonicalization needs recipe-service and mutations
 * cannot do network I/O. The resolution happens BEFORE the write, not at scoring
 * time, for two reasons: re-resolving on every request would pay for the same
 * answer forever, and — the one that matters — the stored data would otherwise
 * be misleading to everything else that reads it. "scallion" sitting in
 * avoidItems looks like a filter and is not one.
 *
 * It FAILS rather than storing an unresolved entry if the dictionary cannot be
 * reached. That is the fail-closed rule the design states for hard filters,
 * applied to the write: storing raw text would leave the user looking at a chip
 * that says their allergen is handled when nothing would ever match it. An error
 * they can retry is recoverable; a silent non-filter is not.
 *
 * Returns the resolutions so the caller can say what happened to each entry —
 * including the ones that matched nothing.
 */
export const addAvoidItems = action({
  args: { entries: v.array(v.string()) },
  handler: async (ctx, { entries }): Promise<AvoidResolution[]> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");

    const wanted = entries.map((e) => e.trim()).filter(Boolean);
    if (wanted.length === 0) return [];

    const baseUrl = process.env.RECIPE_SERVICE_URL;
    if (!baseUrl) throw new Error("RECIPE_SERVICE_URL is not set on the deployment");
    const secret = process.env.RECIPE_SERVICE_SECRET;
    if (!secret) throw new Error("RECIPE_SERVICE_SECRET is not set on the deployment");

    const res = await fetch(`${baseUrl}/normalization/avoid`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Service-Secret": secret,
        "X-User-Id": userId,
      },
      body: JSON.stringify({ entries: wanted }),
      signal: AbortSignal.timeout(RESOLVE_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(
        `Couldn't check those ingredients against the dictionary (recipe-service ${res.status}). Nothing was saved — try again.`,
      );
    }
    const payload = (await res.json()) as { entries?: AvoidResolution[] };
    const resolutions = payload.entries ?? [];

    await ctx.runMutation(internal.preferences.applyAvoidResolutions, {
      resolutions: resolutions.map(({ canonicalItem, input, display, kind, members }) => ({
        canonicalItem,
        input,
        display,
        kind,
        // Only a family has members, and the list can be long; storing it for
        // the other kinds would be storing an empty array forever.
        ...(kind === "allergen" && members?.length ? { members } : {}),
      })),
    });
    return resolutions;
  },
});

/**
 * Merge resolved entries into the stored avoid list.
 *
 * Internal, and the ONLY writer of avoidItems that also writes their
 * resolutions: the two are one fact in two columns, and a public mutation that
 * could set one without the other is how they would drift.
 *
 * Re-adding an entry that is already stored REPLACES its resolution rather than
 * duplicating the key, so the newest thing the user typed is what the chip
 * explains.
 */
export const applyAvoidResolutions = internalMutation({
  args: { resolutions: v.array(avoidResolutionValidator) },
  handler: async (ctx, { resolutions }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");

    const existing = await ctx.db
      .query("preferences")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();

    const byKey = new Map<string, StoredAvoidResolution>();
    for (const r of existing?.avoidResolutions ?? []) byKey.set(r.canonicalItem, r);
    for (const r of resolutions) byKey.set(r.canonicalItem, r);

    const avoidItems = Array.from(
      new Set([...(existing?.avoidItems ?? []), ...resolutions.map((r) => r.canonicalItem)]),
    );
    const avoidResolutions = avoidItems
      .map((item) => byKey.get(item))
      .filter((r): r is StoredAvoidResolution => r !== undefined);

    if (existing === null) {
      await ctx.db.insert("preferences", {
        userId,
        avoidItems,
        avoidResolutions,
        likedItems: [],
        dislikedItems: [],
        updatedAt: Date.now(),
      });
      return;
    }
    await ctx.db.patch(existing._id, { avoidItems, avoidResolutions, updatedAt: Date.now() });
  },
});

/**
 * Drop one avoid entry, by the canonical key it is stored under.
 *
 * A plain mutation, unlike adding: removing needs no dictionary, and making it
 * depend on recipe-service would mean a user could not take an entry off the
 * list while the service was down.
 */
export const removeAvoidItem = mutation({
  args: { canonicalItem: v.string() },
  handler: async (ctx, { canonicalItem }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");

    const existing = await ctx.db
      .query("preferences")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (existing === null) return;

    await ctx.db.patch(existing._id, {
      avoidItems: existing.avoidItems.filter((i) => i !== canonicalItem),
      avoidResolutions: (existing.avoidResolutions ?? []).filter(
        (r) => r.canonicalItem !== canonicalItem,
      ),
      updatedAt: Date.now(),
    });
  },
});

// Somewhere between "just me" and a very large table. The ceiling isn't a guess
// at family sizes so much as a typo guard: 40 batches of everything is never
// what someone meant to ask the grocery list for.
const MAX_HOUSEHOLD_SIZE = 20;

/**
 * Household size, written on its own (BL-0018).
 *
 * Separate from `set` above for two reasons. `set` deliberately preserves
 * fields the caller omits, so it has no way to express "clear this" — and
 * "I'd rather not say" has to stay reachable once a size has been set, since it
 * is what puts every recipe back on a single batch. And a household size is the
 * one preference here that is arithmetic rather than a list of words: it
 * divides into every scaled grocery quantity, so a fractional or zero value has
 * to be refused at the edge rather than quietly multiplied through.
 */
export const setHouseholdSize = mutation({
  args: { householdSize: v.optional(v.number()) },
  handler: async (ctx, { householdSize }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    if (householdSize !== undefined) {
      if (!Number.isInteger(householdSize) || householdSize < 1) {
        throw new Error("householdSize must be a whole number of people, at least 1");
      }
      if (householdSize > MAX_HOUSEHOLD_SIZE) {
        throw new Error(`householdSize must be at most ${MAX_HOUSEHOLD_SIZE}`);
      }
    }
    const existing = await ctx.db
      .query("preferences")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { householdSize, updatedAt: Date.now() });
      return;
    }
    // First thing this user has ever set. The list fields are non-optional on
    // the table, so a row has to be born complete rather than half-formed.
    await ctx.db.insert("preferences", {
      userId,
      avoidItems: [],
      likedItems: [],
      dislikedItems: [],
      householdSize,
      updatedAt: Date.now(),
    });
  },
});
