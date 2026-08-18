import { describe, expect, it } from "vitest";
import { TEST_IDS } from "./sharedTestIDs";
import { TEST_ID_PATTERN } from "./testIDs";

/**
 * Every fixed id in the catalog, written out rather than derived.
 *
 * Deriving them would only restate `sharedTestIDs.ts` and pass no matter what
 * it said. These are the strings two test suites and (once BL-0072 lands) a set
 * of Maestro flows look for, so a rename should fail here and be discussed,
 * which is the whole claim that the id set is an interface.
 *
 * The `auth.*` and `list.confirm-*` values are the ones `apps/mobile` already
 * emits (BL-0056) — the web half adopted them rather than inventing a second
 * vocabulary.
 */
const FIXED_IDS = [
  TEST_IDS.auth.form,
  TEST_IDS.auth.email,
  TEST_IDS.auth.password,
  TEST_IDS.auth.submit,
  TEST_IDS.auth.toggleFlow,
  TEST_IDS.auth.error,
  TEST_IDS.list.emptyState,
  TEST_IDS.list.inCartSection,
  TEST_IDS.list.droppedSection,
  TEST_IDS.list.addToggle,
  TEST_IDS.list.doneShopping,
  TEST_IDS.list.clear,
  TEST_IDS.list.clearConfirm.dialog,
  TEST_IDS.list.clearConfirm.confirm,
  TEST_IDS.list.clearConfirm.cancel,
  TEST_IDS.list.progress,
  TEST_IDS.list.undo,
  TEST_IDS.pantry.emptyState,
  TEST_IDS.plan.generate,
  TEST_IDS.plan.suggest,
  TEST_IDS.plan.suggestAccept,
];

describe("TEST_IDS", () => {
  it("names the shared elements exactly as both clients emit them", () => {
    expect(FIXED_IDS).toEqual([
      "auth.form",
      "auth.email",
      "auth.password",
      "auth.submit",
      "auth.toggle-flow",
      "auth.error",
      "list.empty-state",
      "list.in-cart-section",
      "list.dropped-section",
      "list.add-toggle",
      "list.done-shopping",
      "list.clear",
      "list.confirm-sheet",
      "list.confirm-clear",
      "list.confirm-cancel",
      "list.progress",
      "list.undo",
      "pantry.empty-state",
      "plan.generate",
      "plan.suggest",
      "plan.suggest-accept",
    ]);
  });

  it("gives every element its own id", () => {
    // Two entries resolving to one string means one of them is pointing at the
    // wrong element, and the suite that uses it passes while asserting on
    // something else.
    expect(new Set(FIXED_IDS).size).toBe(FIXED_IDS.length);
  });

  it("keys repeated rows off the data, slugged", () => {
    expect(TEST_IDS.list.item("garlic")).toBe("list.item.garlic");
    expect(TEST_IDS.pantry.item("olive oil")).toBe("pantry.item.olive-oil");
    expect(TEST_IDS.pantry.markUseUp("olive oil")).toBe("pantry.use-up.olive-oil");
    expect(TEST_IDS.plan.unplanned("Garlic Base 12-9")).toBe("plan.unplanned.garlic-base-12-9");
    expect(TEST_IDS.plan.meal("Garlic Base 12-9")).toBe("plan.meal.garlic-base-12-9");
    expect(TEST_IDS.recipes.item("E2E Aisle Walk")).toBe("recipes.item.e2e-aisle-walk");
  });

  it("slugs the same row to the same id however it is capitalised", () => {
    // The web renders the display form and the native screen the canonical one;
    // if those slugged differently the two clients would be pointing at rows
    // the other cannot find.
    expect(TEST_IDS.list.item("Whole Milk")).toBe(TEST_IDS.list.item("whole milk"));
  });

  it("stems the keyed rows so a suite can address them as a set", () => {
    expect(TEST_IDS.list.item("garlic").startsWith(TEST_IDS.list.itemPrefix)).toBe(true);
    expect(TEST_IDS.pantry.item("garlic").startsWith(TEST_IDS.pantry.itemPrefix)).toBe(true);
    expect(TEST_IDS.plan.meal("toast").startsWith(TEST_IDS.plan.mealPrefix)).toBe(true);
  });

  it("produces ids in the documented shape", () => {
    for (const id of [...FIXED_IDS, TEST_IDS.list.item("whole milk")]) {
      expect(TEST_ID_PATTERN.test(id)).toBe(true);
    }
  });
});
