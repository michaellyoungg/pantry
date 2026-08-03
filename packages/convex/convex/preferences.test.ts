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

  it("preserves fields the caller did not supply", async () => {
    const t = convexTest(schema, modules);
    const client = t.withIdentity(identity);

    await client.mutation(api.preferences.set, {
      avoidItems: ["peanut"],
      likedItems: ["garlic"],
      dislikedItems: ["cilantro"],
      dietLabels: ["vegetarian"],
      maxMinutes: 30,
    });
    // Second call supplies ONE field and omits the rest. Every omitted field
    // below is therefore exercising the `args.X ?? existing?.X` fallback — a
    // regression that dropped it would blank them here.
    await client.mutation(api.preferences.set, { cuisines: ["thai"] });

    const prefs = await client.query(api.preferences.get, {});
    expect(prefs.avoidItems).toEqual(["peanut"]);
    expect(prefs.likedItems).toEqual(["garlic"]);
    expect(prefs.dislikedItems).toEqual(["cilantro"]);
    expect(prefs.dietLabels).toEqual(["vegetarian"]);
    expect(prefs.maxMinutes).toBe(30);
    expect(prefs.cuisines).toEqual(["thai"]);
  });

  it("rejects unauthenticated writes", async () => {
    const t = convexTest(schema, modules);
    await expect(t.mutation(api.preferences.set, { avoidItems: ["peanut"] })).rejects.toThrow(
      "Not authenticated",
    );
  });
});

// The one preference the planner reads (BL-0018). It gets its own mutation
// because `set` cannot express clearing and does not do arithmetic validation.
describe("household size (BL-0018)", () => {
  it("is unset until the user says otherwise", async () => {
    const t = convexTest(schema, modules);
    const prefs = await t.withIdentity(identity).query(api.preferences.get, {});
    expect(prefs.householdSize).toBeUndefined();
  });

  it("round-trips what the user set", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(identity);

    await asUser.mutation(api.preferences.setHouseholdSize, { householdSize: 4 });

    expect((await asUser.query(api.preferences.get, {})).householdSize).toBe(4);
  });

  it("updates the existing row rather than opening a second one", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(identity);

    await asUser.mutation(api.preferences.setHouseholdSize, { householdSize: 2 });
    await asUser.mutation(api.preferences.setHouseholdSize, { householdSize: 5 });

    expect((await asUser.query(api.preferences.get, {})).householdSize).toBe(5);
    const rows = await t.run(async (ctx) => ctx.db.query("preferences").collect());
    expect(rows).toHaveLength(1);
  });

  it("clears the preference when given nothing", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(identity);
    await asUser.mutation(api.preferences.setHouseholdSize, { householdSize: 4 });

    await asUser.mutation(api.preferences.setHouseholdSize, {});

    expect((await asUser.query(api.preferences.get, {})).householdSize).toBeUndefined();
  });

  it("leaves the recommendation preferences alone", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(identity);
    await asUser.mutation(api.preferences.set, { avoidItems: ["peanut"] });

    await asUser.mutation(api.preferences.setHouseholdSize, { householdSize: 3 });

    const prefs = await asUser.query(api.preferences.get, {});
    expect(prefs.avoidItems).toEqual(["peanut"]);
    expect(prefs.householdSize).toBe(3);
  });

  it("refuses a household that isn't a whole number of people", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(identity);

    await expect(
      asUser.mutation(api.preferences.setHouseholdSize, { householdSize: 2.5 }),
    ).rejects.toThrow();
    await expect(
      asUser.mutation(api.preferences.setHouseholdSize, { householdSize: 0 }),
    ).rejects.toThrow();
  });

  it("keeps one user's household out of another's", async () => {
    const t = convexTest(schema, modules);
    await t.withIdentity(identity).mutation(api.preferences.setHouseholdSize, { householdSize: 6 });

    const other = await t
      .withIdentity({ subject: "user-b|session" })
      .query(api.preferences.get, {});

    expect(other.householdSize).toBeUndefined();
  });
});
