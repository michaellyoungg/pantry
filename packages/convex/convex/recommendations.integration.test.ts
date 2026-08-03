import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

// getAuthUserId returns the subject up to the "|" divider, so this is the user
// id "integration-user" — same convention as recipes.integration.test.ts.
const USER_ID = "integration-user";
const identity = { subject: `${USER_ID}|session` };

async function seedPantryRice(t: ReturnType<typeof convexTest>) {
  await t.run(async (ctx) =>
    ctx.db.insert("pantryItems", {
      userId: USER_ID,
      canonicalItem: "rice",
      display: "Rice",
      aisle: "pantry",
      state: "have" as const,
      source: "manual" as const,
      updatedAt: 0,
    }),
  );
}

describe("recommendations <-> recipe-service contract", () => {
  // Track ids we create so each test cleans up after itself — the Postgres
  // store persists across runs, so assertions must not assume an empty store.
  let created: string[] = [];

  beforeEach(() => {
    created = [];
  });

  afterEach(async () => {
    const t = convexTest(schema, modules).withIdentity(identity);
    for (const id of created) {
      try {
        await t.action(api.recipes.remove, { id });
      } catch {
        // already gone / test asserted the delete — ignore
      }
    }
  });

  it("ranks a recipe whose ingredients are in the pantry", async () => {
    const t = convexTest(schema, modules);
    const client = t.withIdentity(identity);

    const recipe = await client.action(api.recipes.create, {
      title: "Pantry Rice",
      ingredients: [{ quantity: 1, unit: "cup", item: "rice" }],
    });
    created.push(recipe.id);
    await seedPantryRice(t);

    const results = await client.action(api.recommendations.pantry, {});
    const hit = results.find((r) => r.title === "Pantry Rice");
    expect(hit).toBeDefined();
    expect(hit?.have).toEqual(["rice"]);
    expect(hit?.reasons.length).toBeGreaterThan(0);
  });

  // The contract that matters most: the hard filter survives the full round trip
  // through Convex → HTTP → Go, not just the Go unit test.
  it("never returns a recipe containing an avoided ingredient", async () => {
    const t = convexTest(schema, modules);
    const client = t.withIdentity(identity);

    const recipe = await client.action(api.recipes.create, {
      title: "Peanut Rice",
      ingredients: [
        { quantity: 1, unit: "cup", item: "rice" },
        { quantity: 2, unit: "tbsp", item: "peanut" },
      ],
    });
    created.push(recipe.id);
    await seedPantryRice(t);
    await client.mutation(api.preferences.set, { avoidItems: ["peanut"] });

    const results = await client.action(api.recommendations.pantry, {});
    expect(results.map((r) => r.title)).not.toContain("Peanut Rice");
  });
});
