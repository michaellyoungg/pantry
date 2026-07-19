import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

const USER_ID = "user-a";
const identity = { subject: `${USER_ID}|session` };

async function seed(
  t: ReturnType<typeof convexTest>,
  over: Partial<{
    userId: string;
    canonicalItem: string;
    display: string;
    aisle: string;
    state: "have" | "low" | "out";
    source: "auto" | "manual";
  }> = {},
) {
  return await t.run(async (ctx) =>
    ctx.db.insert("pantryItems", {
      userId: USER_ID,
      canonicalItem: "butter",
      display: "Butter",
      aisle: "dairy",
      state: "have" as const,
      source: "auto" as const,
      updatedAt: 0,
      ...over,
    }),
  );
}

describe("pantry", () => {
  it("lists only the authenticated user's rows", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await seed(t, { userId: "someone-else", canonicalItem: "milk", display: "Milk" });

    const rows = await t.withIdentity(identity).query(api.pantry.list, {});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ canonicalItem: "butter", state: "have" });
  });

  it("sets an item's state", async () => {
    const t = convexTest(schema, modules);
    const id = await seed(t);
    const asUser = t.withIdentity(identity);

    await asUser.mutation(api.pantry.setState, { id, state: "low" });

    const rows = await asUser.query(api.pantry.list, {});
    expect(rows[0].state).toBe("low");
  });

  it("rejects setting state on another user's row (IDOR guard)", async () => {
    const t = convexTest(schema, modules);
    const id = await seed(t, { userId: "someone-else" });

    await expect(
      t.withIdentity(identity).mutation(api.pantry.setState, { id, state: "low" }),
    ).rejects.toThrow();
  });

  it("removes an item", async () => {
    const t = convexTest(schema, modules);
    const id = await seed(t);
    const asUser = t.withIdentity(identity);

    await asUser.mutation(api.pantry.remove, { id });

    expect(await asUser.query(api.pantry.list, {})).toHaveLength(0);
  });

  it("rejects removing another user's row (IDOR guard)", async () => {
    const t = convexTest(schema, modules);
    const id = await seed(t, { userId: "someone-else" });

    await expect(t.withIdentity(identity).mutation(api.pantry.remove, { id })).rejects.toThrow();
  });
});
