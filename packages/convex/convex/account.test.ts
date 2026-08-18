import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id, TableNames } from "./_generated/dataModel";
import schema from "./schema";

// Account deletion (BL-0068). The interesting assertion is not "the mutation
// ran" — it is that NOTHING is left behind. So these tests seed a row in every
// table the schema declares and then require the database to be empty.

const modules = import.meta.glob("./**/*.*s");

/** The three rows every other row points at. */
type SeedIds = {
  userId: Id<"users">;
  sessionId: Id<"authSessions">;
  accountId: Id<"authAccounts">;
};

/**
 * One row per table, all belonging to `ids.userId`.
 *
 * `Record<TableNames, …>` is the point of this map: a table added to schema.ts
 * without an entry here fails to compile, which is exactly the moment to decide
 * whether the cascade in account.ts needs to grow. The alternative — a hand-kept
 * list of tables to check — is the thing that silently goes stale.
 *
 * The three anchor tables are `null`: `seedUser` inserts them first, because
 * everything below needs their ids.
 */
const SEED_ROWS: Record<TableNames, ((ids: SeedIds) => Record<string, unknown>) | null> = {
  users: null,
  authSessions: null,
  authAccounts: null,
  authRefreshTokens: ({ sessionId }) => ({ sessionId, expirationTime: 2_000 }),
  authVerificationCodes: ({ accountId }) => ({
    accountId,
    provider: "password",
    code: "hashed-code",
    expirationTime: 2_000,
  }),
  authVerifiers: ({ sessionId }) => ({ sessionId, signature: "sig" }),
  authRateLimits: ({ accountId }) => ({
    identifier: accountId,
    lastAttemptTime: 1_000,
    attemptsLeft: 3,
  }),
  preferences: ({ userId }) => ({
    userId,
    avoidItems: ["peanut"],
    likedItems: [],
    dislikedItems: [],
    updatedAt: 1_000,
  }),
  basket: ({ userId }) => ({ userId, recipeId: "r1", title: "Toast", weekday: 2 }),
  groceryList: ({ userId }) => ({
    userId,
    item: "Butter",
    unit: "g",
    quantity: 100,
    aisle: "dairy",
    checked: false,
  }),
  shoppingPresence: ({ userId }) => ({ userId, sessionId: "device-1", lastSeenAt: 1_000 }),
  equipmentInventory: ({ userId }) => ({ userId, equipmentId: "slow_cooker", addedAt: 1_000 }),
  nutritionTargets: ({ userId }) => ({
    userId,
    nutrientId: "1003",
    operator: ">=",
    value: 50,
    period: "day",
    active: true,
  }),
  prepTaskState: ({ userId }) => ({
    userId,
    taskKey: "thaw:chicken",
    cookDate: "2026-08-17",
    done: true,
  }),
  pantryItems: ({ userId }) => ({
    userId,
    canonicalItem: "butter",
    display: "Butter",
    aisle: "dairy",
    state: "have",
    source: "manual",
    updatedAt: 1_000,
  }),
  recommendationEvents: ({ userId }) => ({
    userId,
    recipeId: "r1",
    context: "discover",
    action: "shown",
    createdAt: 1_000,
  }),
  nutritionLog: ({ userId }) => ({
    userId,
    date: "2026-08-17",
    recipeId: "r1",
    servings: 1,
    source: "planned",
    snapshot: { nutrients: {}, coverage: 1 },
    loggedAt: 1_000,
  }),
};

/**
 * Taken from the schema at runtime, not from `SEED_ROWS`.
 *
 * That direction is what makes the guard real: a table added to schema.ts but
 * not seeded above is simply never written, so the "every table was seeded"
 * assertion names it. Reading the list off `SEED_ROWS` instead would make the
 * test agree with itself about a table nobody had heard of.
 */
const TABLES = Object.keys(schema.tables) as TableNames[];

type Seed = (ids: SeedIds) => Record<string, unknown>;

/**
 * `db.insert`/`db.query` are overloaded per table, so a variable table name
 * needs a cast. The row shapes above are still checked — convex-test validates
 * every write against schema.ts at runtime, which is the guarantee that matters
 * here.
 */
type LooseDb = {
  insert: (table: string, doc: Record<string, unknown>) => Promise<string>;
  query: (table: string) => { collect: () => Promise<unknown[]> };
};

/** Seeds one complete user — every table, all of it theirs. */
async function seedUser(t: ReturnType<typeof convexTest>, email: string): Promise<SeedIds> {
  return await t.run(async (ctx) => {
    const db = ctx.db as unknown as LooseDb;
    const userId = (await db.insert("users", { email })) as Id<"users">;
    const sessionId = (await db.insert("authSessions", {
      userId,
      expirationTime: 2_000,
    })) as Id<"authSessions">;
    const accountId = (await db.insert("authAccounts", {
      userId,
      provider: "password",
      providerAccountId: email,
      secret: "hashed-secret",
    })) as Id<"authAccounts">;

    const ids = { userId, sessionId, accountId };
    for (const table of TABLES) {
      // `undefined` means schema.ts declares a table SEED_ROWS has never heard
      // of. Left unwritten on purpose: the caller's assertion reports it.
      const row: Seed | null | undefined = SEED_ROWS[table];
      if (row !== null && row !== undefined) await db.insert(table, row(ids));
    }
    return ids;
  });
}

/** Every table that still holds a row, so a failure names the leak. */
async function nonEmptyTables(t: ReturnType<typeof convexTest>): Promise<string[]> {
  return await t.run(async (ctx) => {
    const db = ctx.db as unknown as LooseDb;
    const left: string[] = [];
    for (const table of TABLES) {
      if ((await db.query(table).collect()).length > 0) left.push(table);
    }
    return left;
  });
}

/** Stubs recipe-service. `status` 500 makes the cascade's first half fail. */
function stubRecipeService({ status = 200 } = {}) {
  const fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify(status === 200 ? { deleted: 2 } : { error: "boom" }), {
        status,
        headers: { "content-type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  process.env.RECIPE_SERVICE_URL = "http://recipe-service.test";
  process.env.RECIPE_SERVICE_SECRET = "test-secret";
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("account.purgeUserData", () => {
  it("leaves no row in any table the schema declares", async () => {
    const t = convexTest(schema, modules);
    const { userId } = await seedUser(t, "a@example.test");
    // Guard the guard: a table nothing was written to would make the assertion
    // below pass for the wrong reason. Compared as a list rather than a count
    // so a miss names the table.
    expect(await nonEmptyTables(t)).toEqual(TABLES);

    await t.mutation(internal.account.purgeUserData, { userId });

    expect(await nonEmptyTables(t)).toEqual([]);
  });

  it("leaves every other user's rows exactly where they were", async () => {
    const t = convexTest(schema, modules);
    const { userId } = await seedUser(t, "a@example.test");
    await seedUser(t, "b@example.test");

    await t.mutation(internal.account.purgeUserData, { userId });

    // One complete user's worth of rows, in every table.
    expect(await nonEmptyTables(t)).toEqual(TABLES);
  });
});

describe("account.deleteAccount", () => {
  it("deletes the user's recipes before touching Convex, then purges", async () => {
    const fetchMock = stubRecipeService();
    const t = convexTest(schema, modules);
    const { userId, sessionId } = await seedUser(t, "a@example.test");

    await t
      .withIdentity({ subject: `${userId}|${sessionId}` })
      .action(api.account.deleteAccount, { confirmation: "DELETE" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://recipe-service.test/users/me/recipes");
    expect(init.method).toBe("DELETE");
    expect((init.headers as Record<string, string>)["X-User-Id"]).toBe(userId);
    expect(await nonEmptyTables(t)).toEqual([]);
  });

  // The ordering guarantee: the Convex user row is the only handle on those
  // Postgres recipes, so a failed remote delete must leave the account intact
  // and retryable rather than stranding a corpus nobody can reach.
  it("keeps the account when recipe-service refuses", async () => {
    stubRecipeService({ status: 500 });
    const t = convexTest(schema, modules);
    const { userId, sessionId } = await seedUser(t, "a@example.test");

    await expect(
      t
        .withIdentity({ subject: `${userId}|${sessionId}` })
        .action(api.account.deleteAccount, { confirmation: "DELETE" }),
    ).rejects.toThrow();

    expect(await nonEmptyTables(t)).toEqual(TABLES);
  });

  it("refuses a confirmation that is not the word, without calling anything", async () => {
    const fetchMock = stubRecipeService();
    const t = convexTest(schema, modules);
    const { userId, sessionId } = await seedUser(t, "a@example.test");

    await expect(
      t
        .withIdentity({ subject: `${userId}|${sessionId}` })
        .action(api.account.deleteAccount, { confirmation: "delete" }),
    ).rejects.toThrow(/DELETE/);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(await nonEmptyTables(t)).toEqual(TABLES);
  });

  it("rejects an unauthenticated caller", async () => {
    stubRecipeService();
    const t = convexTest(schema, modules);
    await seedUser(t, "a@example.test");

    await expect(t.action(api.account.deleteAccount, { confirmation: "DELETE" })).rejects.toThrow(
      /Not authenticated/,
    );

    expect(await nonEmptyTables(t)).toEqual(TABLES);
  });
});
