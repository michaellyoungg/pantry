import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

const USER_ID = "user-a";
const identity = { subject: `${USER_ID}|session` };

describe("household size (BL-0018)", () => {
  it("is unset until the user says otherwise", async () => {
    const t = convexTest(schema, modules);
    // Convex drops undefined fields over the wire, so the shape is `{}` — what
    // matters to every caller is that reading the size gives nothing.
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

  it("requires authentication", async () => {
    const t = convexTest(schema, modules);
    await expect(t.query(api.preferences.get, {})).rejects.toThrow();
  });
});
