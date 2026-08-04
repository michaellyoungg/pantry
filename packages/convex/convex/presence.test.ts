import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import { PRESENCE_TTL_MS } from "./presence";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

const USER_ID = "user-a";
const identity = { subject: `${USER_ID}|session` };

// BL-0019: the list has always been live; presence is the part that says so.
describe("shopping presence", () => {
  it("does not count the caller's own session — 'you are here' is not news", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(identity);
    await asUser.mutation(api.presence.heartbeat, { sessionId: "phone" });

    expect(await asUser.query(api.presence.shoppers, { sessionId: "phone" })).toBe(0);
  });

  it("counts another device on the same household list", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(identity);
    await asUser.mutation(api.presence.heartbeat, { sessionId: "phone" });
    await asUser.mutation(api.presence.heartbeat, { sessionId: "tablet" });

    expect(await asUser.query(api.presence.shoppers, { sessionId: "phone" })).toBe(1);
  });

  it("keeps one row per device however long the shop runs", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(identity);
    for (let i = 0; i < 5; i++) {
      await asUser.mutation(api.presence.heartbeat, { sessionId: "phone" });
    }

    const rows = await t.run(async (ctx) => ctx.db.query("shoppingPresence").collect());
    expect(rows).toHaveLength(1);
  });

  it("ages a device out once it stops beating", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(identity);
    await asUser.mutation(api.presence.heartbeat, { sessionId: "tablet" });
    // The tablet went into a pocket: its row is still there, just stale.
    await t.run(async (ctx) => {
      const row = await ctx.db.query("shoppingPresence").first();
      if (row) await ctx.db.patch(row._id, { lastSeenAt: Date.now() - PRESENCE_TTL_MS - 1_000 });
    });

    expect(await asUser.query(api.presence.shoppers, { sessionId: "phone" })).toBe(0);
  });

  it("sweeps a long-silent row rather than leaving it to accumulate", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(identity);
    await asUser.mutation(api.presence.heartbeat, { sessionId: "tablet" });
    await t.run(async (ctx) => {
      const row = await ctx.db.query("shoppingPresence").first();
      if (row) await ctx.db.patch(row._id, { lastSeenAt: Date.now() - 60 * 60_000 });
    });

    await asUser.mutation(api.presence.heartbeat, { sessionId: "phone" });

    const rows = await t.run(async (ctx) => ctx.db.query("shoppingPresence").collect());
    expect(rows.map((r) => r.sessionId)).toEqual(["phone"]);
  });

  it("never leaks another household's shoppers", async () => {
    const t = convexTest(schema, modules);
    await t
      .withIdentity({ subject: "someone-else|s" })
      .mutation(api.presence.heartbeat, { sessionId: "their-phone" });

    expect(
      await t.withIdentity(identity).query(api.presence.shoppers, { sessionId: "phone" }),
    ).toBe(0);
  });

  it("requires a signed-in user", async () => {
    const t = convexTest(schema, modules);
    await expect(t.mutation(api.presence.heartbeat, { sessionId: "phone" })).rejects.toThrow(
      /not authenticated/i,
    );
  });
});
