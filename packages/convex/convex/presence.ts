import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// Who else is shopping right now (BL-0019).
//
// The list has been genuinely live since it was built on Convex — two phones
// in a shop already see each other's ticks — but nothing on screen ever said
// so. That silence is the problem: a line that strikes itself through under
// your thumb reads as a bug unless the app has already told you someone else
// is holding the other half of the list.
//
// Presence is deliberately the crudest thing that answers that: a count of
// live sessions, no names, no cursors, no per-line "who". The question a
// shopper actually has in an aisle is "is anyone else picking things up?", and
// a number answers it.

/**
 * How long a session counts as present after its last heartbeat.
 *
 * Comfortably more than the client's heartbeat interval, so one dropped beat on
 * a shop's bad signal does not blink the other shopper out of existence.
 */
export const PRESENCE_TTL_MS = 45_000;

/** How long a silent row is kept before a later heartbeat sweeps it away. */
const PRESENCE_SWEEP_MS = 10 * 60_000;

/**
 * "I am still here." Called on an interval by any client with the list open.
 *
 * Upserts in place rather than appending, so a long shop costs one row per
 * device rather than one row per beat. There is no matching "goodbye": a closed
 * tab, a dead battery and a lift with no signal are indistinguishable from the
 * server's side, so absence is only ever inferred from silence.
 */
export const heartbeat = mutation({
  args: { sessionId: v.string() },
  handler: async (ctx, { sessionId }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const now = Date.now();

    const existing = await ctx.db
      .query("shoppingPresence")
      .withIndex("by_user_session", (q) => q.eq("userId", userId).eq("sessionId", sessionId))
      .unique();
    if (existing) await ctx.db.patch(existing._id, { lastSeenAt: now });
    else await ctx.db.insert("shoppingPresence", { userId, sessionId, lastSeenAt: now });

    // Sweep long-silent rows on the way past. Doing it here rather than on a
    // cron keeps the table self-cleaning without a scheduled function whose
    // only job is a handful of deletes.
    for (const row of await ctx.db
      .query("shoppingPresence")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect()) {
      if (row.sessionId !== sessionId && now - row.lastSeenAt > PRESENCE_SWEEP_MS) {
        await ctx.db.delete(row._id);
      }
    }
  },
});

/**
 * How many *other* devices are on the list right now.
 *
 * Excludes the caller's own session, because "1 other shopper" is the useful
 * statement and "you are here" is not. The count is only as fresh as the last
 * write to the table — but the caller is itself heartbeating, so the query
 * re-runs every beat and a shopper who has gone quiet ages out on schedule.
 */
export const shoppers = query({
  args: { sessionId: v.string() },
  handler: async (ctx, { sessionId }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const cutoff = Date.now() - PRESENCE_TTL_MS;
    const rows = await ctx.db
      .query("shoppingPresence")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    return rows.filter((row) => row.sessionId !== sessionId && row.lastSeenAt > cutoff).length;
  },
});
