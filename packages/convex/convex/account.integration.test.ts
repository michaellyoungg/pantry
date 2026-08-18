import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// Cross-service contract test for account deletion (BL-0068). The action makes
// a REAL DELETE /users/me/recipes against a running recipe-service — no fetch
// mock — because the half of the cascade that lives in Postgres is precisely
// the half a Convex-only test cannot see.
//
// Run via `pnpm --filter @pantry/convex test:integration` (or top-level
// `pnpm test:integration`), NOT the default `pnpm test`.

const modules = import.meta.glob("./**/*.*s");

// recipe-service's sentinel owner for the shared catalog. Mirrors
// internal/recipe/types.go's CatalogUserID.
const CATALOG_USER_ID = "catalog";

/**
 * A real Convex user, signed in.
 *
 * Unlike the other integration suites this cannot invent a user id string: the
 * purge takes a `v.id("users")`, and in production the id recipe-service sees
 * in `X-User-Id` IS that document id. Seeding the row keeps the test on the
 * same identity the real flow uses.
 */
async function signedInUser(t: ReturnType<typeof convexTest>) {
  const userId = await t.run(async (ctx) => ctx.db.insert("users", { email: "del@example.test" }));
  return t.withIdentity({ subject: `${userId}|session` });
}

describe("account deletion <-> recipe-service contract", () => {
  it("deletes the user's recipes and leaves another owner's alone", async () => {
    const t = convexTest(schema, modules);
    const as = await signedInUser(t);

    const mine = await as.action(api.recipes.create, {
      title: "Doomed Toast",
      ingredients: [{ quantity: 2, unit: "slices", item: "bread" }],
    });
    expect((await as.action(api.recipes.list, {})).some((r) => r.id === mine.id)).toBe(true);

    // The other owner is the catalog sentinel on purpose: it is what a
    // mis-scoped delete would take out first, and the one nobody can restore.
    const catalog = convexTest(schema, modules).withIdentity({
      subject: `${CATALOG_USER_ID}|session`,
    });
    const theirs = await catalog.action(api.recipes.create, {
      title: "Catalog Chili",
      ingredients: [{ quantity: 1, unit: "can", item: "kidney beans" }],
    });

    try {
      await as.action(api.account.deleteAccount, { confirmation: "DELETE" });

      // Asked as the deleted user: the Convex identity is gone, but the recipes
      // are what this asserts on and the service answers by user id.
      expect(await as.action(api.recipes.list, {})).toEqual([]);
      expect((await catalog.action(api.recipes.list, {})).some((r) => r.id === theirs.id)).toBe(
        true,
      );
    } finally {
      await catalog.action(api.recipes.remove, { id: theirs.id });
    }
  });

  it("succeeds for a user who never wrote a recipe", async () => {
    const t = convexTest(schema, modules);
    const as = await signedInUser(t);

    await as.action(api.account.deleteAccount, { confirmation: "DELETE" });

    expect(await as.action(api.recipes.list, {})).toEqual([]);
  });

  it("refuses without the typed confirmation, leaving the recipes in place", async () => {
    const t = convexTest(schema, modules);
    const as = await signedInUser(t);

    const mine = await as.action(api.recipes.create, {
      title: "Kept Toast",
      ingredients: [{ quantity: 2, unit: "slices", item: "bread" }],
    });
    try {
      await expect(as.action(api.account.deleteAccount, { confirmation: "" })).rejects.toThrow(
        /DELETE/,
      );
      expect((await as.action(api.recipes.list, {})).some((r) => r.id === mine.id)).toBe(true);
    } finally {
      await as.action(api.recipes.remove, { id: mine.id });
    }
  });
});
