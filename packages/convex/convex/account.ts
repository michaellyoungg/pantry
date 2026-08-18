import { getAuthUserId } from "@convex-dev/auth/server";
import type { AccountDeletionConfirmation } from "@pantry/types";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id, TableNames } from "./_generated/dataModel";
import { action, internalMutation, type MutationCtx } from "./_generated/server";
import { withSpan } from "./lib/otel";
import { recipeServiceFetch } from "./recipes";

// Account deletion (BL-0068).
//
// A user's data is spread over ten Convex tables and the seven this
// deployment inherits from `authTables`, plus a Postgres corpus of recipes
// behind recipe-service. Nothing in the type system relates those to each
// other, so the cascade below is ENUMERATED rather than inferred, and
// `account.test.ts` seeds a row in every table the schema declares — a table
// added later and forgotten here fails the typecheck before it can become a
// silent data-retention bug.

/**
 * What a client must send to confirm deletion.
 *
 * Checked on the server as well as in the UI. This cannot prove a human typed
 * it — nothing server-side can — and that is not what it is for: it stops a
 * second client, an e2e script, or a future mobile build from reaching an
 * irreversible mutation without having built the confirmation step at all.
 *
 * Declared here as a literal rather than imported: `@pantry/types` ships as
 * dist only and the Convex bundler resolves it without a build step only while
 * every import from it is `import type`. The guard below is what keeps this
 * copy and the one the clients read provably identical (see recipes.ts, which
 * duplicates the cooking-method enum the same way).
 */
export const DELETE_CONFIRMATION = "DELETE" as const;

type Equals<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
export const _deleteConfirmationInSync: Equals<
  typeof DELETE_CONFIRMATION,
  AccountDeletionConfirmation
> = true;

/**
 * Every table keyed on `userId` and reachable by an index of that name.
 *
 * `recommendationEvents` and `nutritionLog` are user-scoped too but are absent
 * here: neither carries a bare `by_user` index, so both are swept below
 * through the `userId` prefix of a composite one.
 */
const BY_USER_TABLES = [
  "preferences",
  "basket",
  "groceryList",
  "shoppingPresence",
  "equipmentInventory",
  "nutritionTargets",
  "prepTaskState",
  "pantryItems",
  "storeSelection",
] as const;

async function deleteRows<T extends TableNames>(
  ctx: MutationCtx,
  rows: { _id: Id<T> }[],
): Promise<void> {
  for (const row of rows) await ctx.db.delete(row._id);
}

/**
 * Erase everything this deployment holds about one user.
 *
 * Internal, and takes the user id as an argument rather than reading the
 * identity: the caller is an action that has already authenticated, and by the
 * time this finishes the session it authenticated with no longer exists.
 *
 * Deliberately a single mutation, so it is one transaction. A cascade that
 * committed table by table could leave an account with its auth rows gone and
 * its pantry intact — unreachable data with no user left who could ask for it.
 */
export const purgeUserData = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    for (const table of BY_USER_TABLES) {
      await deleteRows(
        ctx,
        await ctx.db
          .query(table)
          .withIndex("by_user", (q) => q.eq("userId", userId))
          .collect(),
      );
    }
    await deleteRows(
      ctx,
      await ctx.db
        .query("recommendationEvents")
        .withIndex("by_user_created", (q) => q.eq("userId", userId))
        .collect(),
    );
    await deleteRows(
      ctx,
      await ctx.db
        .query("nutritionLog")
        .withIndex("by_user_date", (q) => q.eq("userId", userId))
        .collect(),
    );

    // --- auth ---
    //
    // The library gives us `invalidateSessions`, but it is action-only and this
    // has to run inside the transaction that removes the user, so the teardown
    // is done here against the same tables `authTables` declares.
    const sessions = await ctx.db
      .query("authSessions")
      .withIndex("userId", (q) => q.eq("userId", userId))
      .collect();

    // authVerifiers is the one auth table with no index that can find a user's
    // rows: it is keyed by OAuth `signature`, and its `sessionId` is optional.
    // The scan is affordable exactly because the table is empty here — this
    // deployment runs the Password provider only (convex/auth.ts), and even
    // under OAuth a verifier lives for one sign-in redirect. It is swept before
    // the sessions it points at, so the match is still possible.
    const sessionIds = new Set<string>(sessions.map((s) => s._id));
    for (const verifier of await ctx.db.query("authVerifiers").collect()) {
      if (verifier.sessionId !== undefined && sessionIds.has(verifier.sessionId)) {
        await ctx.db.delete(verifier._id);
      }
    }

    for (const session of sessions) {
      await deleteRows(
        ctx,
        await ctx.db
          .query("authRefreshTokens")
          .withIndex("sessionId", (q) => q.eq("sessionId", session._id))
          .collect(),
      );
      await ctx.db.delete(session._id);
    }

    for (const account of await ctx.db
      .query("authAccounts")
      .withIndex("userIdAndProvider", (q) => q.eq("userId", userId))
      .collect()) {
      await deleteRows(
        ctx,
        await ctx.db
          .query("authVerificationCodes")
          .withIndex("accountId", (q) => q.eq("accountId", account._id))
          .collect(),
      );
      // Sign-in throttling is keyed on the account id, so this is the only
      // place the rows can be found — and leaving one behind would hand the
      // next account to reuse that id a stranger's failed-attempt budget.
      await deleteRows(
        ctx,
        await ctx.db
          .query("authRateLimits")
          .withIndex("identifier", (q) => q.eq("identifier", account._id))
          .collect(),
      );
      await ctx.db.delete(account._id);
    }

    await ctx.db.delete(userId);
  },
});

/**
 * Delete the signed-in user's account and everything in it. Irreversible.
 *
 * recipe-service goes FIRST, and the order is the whole design. The Convex
 * `users` row is the only handle anyone has on the Postgres recipes — they are
 * keyed by the user id and nothing else — so purging Convex first and then
 * failing the remote call would strand a corpus that no client could ever ask
 * about again. This way a failure leaves the account intact and the user can
 * press the button a second time: both halves are idempotent.
 *
 * Clients should sign out once this returns. The sessions are already gone
 * server-side, but the browser still holds a JWT that outlives them, and
 * sitting in a signed-in shell for a deleted account is not a state worth
 * rendering.
 */
export const deleteAccount = action({
  args: { confirmation: v.string(), traceCtx: v.optional(v.string()) },
  handler: async (ctx, { confirmation, traceCtx }): Promise<null> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    if (confirmation !== DELETE_CONFIRMATION) {
      throw new Error(`Account deletion must be confirmed with "${DELETE_CONFIRMATION}"`);
    }
    await withSpan("account.deleteAccount", traceCtx, (traceparent) =>
      recipeServiceFetch<{ deleted: number }>(
        userId,
        "DELETE",
        "/users/me/recipes",
        undefined,
        traceparent,
      ),
    );
    await ctx.runMutation(internal.account.purgeUserData, { userId });
    return null;
  },
});
