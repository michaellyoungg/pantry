import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

const USER_ID = "user-a";
const identity = { subject: `${USER_ID}|session` };

describe("preferences", () => {
  it("returns empty defaults when the user has never set any", async () => {
    const t = convexTest(schema, modules);
    const prefs = await t.withIdentity(identity).query(api.preferences.get, {});
    expect(prefs).toMatchObject({ avoidItems: [], likedItems: [], dislikedItems: [] });
  });

  it("round-trips what was set", async () => {
    const t = convexTest(schema, modules);
    await t
      .withIdentity(identity)
      .mutation(api.preferences.set, { avoidItems: ["peanut"], likedItems: ["garlic"] });

    const prefs = await t.withIdentity(identity).query(api.preferences.get, {});
    expect(prefs.avoidItems).toEqual(["peanut"]);
    expect(prefs.likedItems).toEqual(["garlic"]);
  });

  it("updates in place rather than inserting a second row", async () => {
    const t = convexTest(schema, modules);
    const client = t.withIdentity(identity);
    await client.mutation(api.preferences.set, { avoidItems: ["peanut"] });
    await client.mutation(api.preferences.set, { avoidItems: ["shellfish"] });

    const rows = await t.run(async (ctx) => await ctx.db.query("preferences").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0].avoidItems).toEqual(["shellfish"]);
  });

  it("never returns another user's preferences", async () => {
    const t = convexTest(schema, modules);
    await t.withIdentity(identity).mutation(api.preferences.set, { avoidItems: ["peanut"] });

    const other = await t
      .withIdentity({ subject: "user-b|session" })
      .query(api.preferences.get, {});
    expect(other.avoidItems).toEqual([]);
  });

  it("normalizes avoid items to canonical lowercase keys", async () => {
    const t = convexTest(schema, modules);
    await t.withIdentity(identity).mutation(api.preferences.set, { avoidItems: ["  Peanut  "] });
    const prefs = await t.withIdentity(identity).query(api.preferences.get, {});
    expect(prefs.avoidItems).toEqual(["peanut"]);
  });

  it("rejects unauthenticated reads", async () => {
    const t = convexTest(schema, modules);
    await expect(t.query(api.preferences.get, {})).rejects.toThrow("Not authenticated");
  });
});
