import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

const USER_ID = "user-a";
const identity = { subject: `${USER_ID}|session` };
const other = { subject: "user-b|session" };

const PROTEIN = "1003";
const CHOLESTEROL = "1253";
const CARBS = "1005";

function targetArgs(over: Record<string, unknown> = {}) {
  return {
    nutrientId: PROTEIN,
    operator: ">=" as const,
    value: 150,
    period: "day" as const,
    ...over,
  };
}

describe("nutritionTargets.list", () => {
  it("returns nothing before any goal is set", async () => {
    const t = convexTest(schema, modules);
    expect(await t.withIdentity(identity).query(api.nutritionTargets.list, {})).toEqual([]);
  });

  it("returns only the authenticated user's rows", async () => {
    const t = convexTest(schema, modules);
    await t.withIdentity(identity).mutation(api.nutritionTargets.add, targetArgs());
    await t
      .withIdentity(other)
      .mutation(api.nutritionTargets.add, targetArgs({ nutrientId: CARBS }));

    const mine = await t.withIdentity(identity).query(api.nutritionTargets.list, {});
    expect(mine.map((r) => r.nutrientId)).toEqual([PROTEIN]);
  });

  it("rejects an unauthenticated read", async () => {
    const t = convexTest(schema, modules);
    await expect(t.query(api.nutritionTargets.list, {})).rejects.toThrow(/authenticated/i);
  });
});

describe("nutritionTargets.add", () => {
  it("stores a goal as active", async () => {
    const t = convexTest(schema, modules);
    await t.withIdentity(identity).mutation(api.nutritionTargets.add, targetArgs());
    const [row] = await t.withIdentity(identity).query(api.nutritionTargets.list, {});
    expect(row).toMatchObject({ nutrientId: PROTEIN, operator: ">=", value: 150, active: true });
  });

  it("keeps an optional label", async () => {
    const t = convexTest(schema, modules);
    await t
      .withIdentity(identity)
      .mutation(api.nutritionTargets.add, targetArgs({ label: "Bulking" }));
    const [row] = await t.withIdentity(identity).query(api.nutritionTargets.list, {});
    expect(row.label).toBe("Bulking");
  });

  it("replaces an existing constraint on the same nutrient and period", async () => {
    // Two contradictory rules for one nutrient in one window is not a goal, it
    // is a bug the user cannot see. Setting it again re-tunes the number.
    const t = convexTest(schema, modules);
    await t.withIdentity(identity).mutation(api.nutritionTargets.add, targetArgs({ value: 150 }));
    await t.withIdentity(identity).mutation(api.nutritionTargets.add, targetArgs({ value: 180 }));
    const rows = await t.withIdentity(identity).query(api.nutritionTargets.list, {});
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe(180);
  });

  it("keeps the same nutrient in a different period as a separate goal", async () => {
    const t = convexTest(schema, modules);
    await t
      .withIdentity(identity)
      .mutation(api.nutritionTargets.add, targetArgs({ period: "day" }));
    await t
      .withIdentity(identity)
      .mutation(api.nutritionTargets.add, targetArgs({ period: "week", value: 1000 }));
    const rows = await t.withIdentity(identity).query(api.nutritionTargets.list, {});
    expect(rows).toHaveLength(2);
  });

  it("reactivates a paused goal when it is set again", async () => {
    const t = convexTest(schema, modules);
    const id = await t.withIdentity(identity).mutation(api.nutritionTargets.add, targetArgs());
    await t.withIdentity(identity).mutation(api.nutritionTargets.setActive, { id, active: false });
    await t.withIdentity(identity).mutation(api.nutritionTargets.add, targetArgs({ value: 200 }));
    const [row] = await t.withIdentity(identity).query(api.nutritionTargets.list, {});
    expect(row).toMatchObject({ active: true, value: 200 });
  });

  it("rejects a negative target value", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.withIdentity(identity).mutation(api.nutritionTargets.add, targetArgs({ value: -5 })),
    ).rejects.toThrow(/value/i);
  });

  it("rejects a non-finite target value", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t
        .withIdentity(identity)
        .mutation(api.nutritionTargets.add, targetArgs({ value: Number.NaN })),
    ).rejects.toThrow(/value/i);
  });

  it("rejects an unauthenticated write", async () => {
    const t = convexTest(schema, modules);
    await expect(t.mutation(api.nutritionTargets.add, targetArgs())).rejects.toThrow(
      /authenticated/i,
    );
  });
});

describe("nutritionTargets.setActive", () => {
  it("pauses a goal without destroying the tuned number", async () => {
    const t = convexTest(schema, modules);
    const id = await t
      .withIdentity(identity)
      .mutation(api.nutritionTargets.add, targetArgs({ value: 175 }));
    await t.withIdentity(identity).mutation(api.nutritionTargets.setActive, { id, active: false });
    const [row] = await t.withIdentity(identity).query(api.nutritionTargets.list, {});
    expect(row).toMatchObject({ active: false, value: 175 });
  });

  it("refuses to touch another user's goal", async () => {
    const t = convexTest(schema, modules);
    const id = await t.withIdentity(identity).mutation(api.nutritionTargets.add, targetArgs());
    await expect(
      t.withIdentity(other).mutation(api.nutritionTargets.setActive, { id, active: false }),
    ).rejects.toThrow(/not found/i);
  });
});

describe("nutritionTargets.remove", () => {
  it("deletes the user's goal", async () => {
    const t = convexTest(schema, modules);
    const id = await t.withIdentity(identity).mutation(api.nutritionTargets.add, targetArgs());
    await t.withIdentity(identity).mutation(api.nutritionTargets.remove, { id });
    expect(await t.withIdentity(identity).query(api.nutritionTargets.list, {})).toEqual([]);
  });

  it("refuses to delete another user's goal", async () => {
    const t = convexTest(schema, modules);
    const id = await t.withIdentity(identity).mutation(api.nutritionTargets.add, targetArgs());
    await expect(
      t.withIdentity(other).mutation(api.nutritionTargets.remove, { id }),
    ).rejects.toThrow(/not found/i);
    expect(await t.withIdentity(identity).query(api.nutritionTargets.list, {})).toHaveLength(1);
  });
});

describe("nutritionTargets.applyPreset", () => {
  // The mutation takes rows, never a preset name: that is what keeps presets
  // data. A preset served from anywhere — a JSON file today, a table later —
  // arrives here as the same argument and needs no new code.
  it("stores every row of the bundle", async () => {
    const t = convexTest(schema, modules);
    await t.withIdentity(identity).mutation(api.nutritionTargets.applyPreset, {
      targets: [
        targetArgs({ nutrientId: CHOLESTEROL, operator: "<=", value: 200 }),
        targetArgs({ nutrientId: "1258", operator: "<=", value: 15 }),
      ],
    });
    const rows = await t.withIdentity(identity).query(api.nutritionTargets.list, {});
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.active)).toBe(true);
  });

  it("re-tunes an existing goal rather than contradicting it", async () => {
    const t = convexTest(schema, modules);
    await t
      .withIdentity(identity)
      .mutation(api.nutritionTargets.add, targetArgs({ nutrientId: CARBS, value: 300 }));
    await t.withIdentity(identity).mutation(api.nutritionTargets.applyPreset, {
      targets: [targetArgs({ nutrientId: CARBS, operator: "<=", value: 50 })],
    });
    const rows = await t.withIdentity(identity).query(api.nutritionTargets.list, {});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ operator: "<=", value: 50 });
  });

  it("leaves goals the preset does not mention alone", async () => {
    const t = convexTest(schema, modules);
    await t
      .withIdentity(identity)
      .mutation(api.nutritionTargets.add, targetArgs({ nutrientId: PROTEIN }));
    await t.withIdentity(identity).mutation(api.nutritionTargets.applyPreset, {
      targets: [targetArgs({ nutrientId: CARBS, operator: "<=", value: 50 })],
    });
    const rows = await t.withIdentity(identity).query(api.nutritionTargets.list, {});
    expect(rows.map((r) => r.nutrientId).sort()).toEqual([PROTEIN, CARBS].sort());
  });

  it("rejects an empty bundle", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.withIdentity(identity).mutation(api.nutritionTargets.applyPreset, { targets: [] }),
    ).rejects.toThrow(/no targets/i);
  });

  it("rejects an unauthenticated write", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(api.nutritionTargets.applyPreset, { targets: [targetArgs()] }),
    ).rejects.toThrow(/authenticated/i);
  });
});
