import { expect, type Page, test } from "@playwright/test";
import { createRecipeAndAddToBasket, navigateTo, signUp, uniqueSuffix } from "./helpers";

/**
 * "Suggest my week" (BL-0033) end to end.
 *
 * What only a browser can prove here is the anti-friction contract: pressing the
 * button changes NOTHING until the proposal is accepted, and accepting it never
 * disturbs a day the user had already planned. Both are properties of the whole
 * loop — Convex mutations, the reactive basket, and the planner grid — not of
 * any one unit.
 *
 * The recipes are the test's own. `weekCandidates` sends `includeUnmatched`, so
 * a user recipe is an eligible candidate without any pantry state at all, which
 * keeps this spec independent of the shared catalog (empty in e2e until BL-0051
 * lands) and of the grocery/check-off loop.
 */

/** The suggester card, scoped by its heading so /plan's other cards can't match. */
function suggester(page: Page) {
  return page.locator("section").filter({ hasText: "Suggest my week" });
}

/** One day column of the week grid. Each is a region named for its weekday. */
function dayColumn(page: Page, fullDay: string) {
  return page.getByRole("region", { name: fullDay, exact: true });
}

test("proposes a week, writes nothing until accepted, then plans it", async ({ page }) => {
  await signUp(page);

  // Two recipes sharing an ingredient, so the set-level explanation has
  // something true to say about them.
  const suffix = uniqueSuffix();
  const first = `Chicken Rice ${suffix}`;
  const second = `Chicken Tacos ${suffix}`;
  await createRecipeAndAddToBasket(page, first, { quantity: "1", unit: "lb", item: "chicken" });
  await createRecipeAndAddToBasket(page, second, { quantity: "2", unit: "lb", item: "chicken" });

  await navigateTo(page, "Plan");
  const card = suggester(page);
  await card.getByRole("button", { name: "Suggest my week" }).click();

  // A proposal, explicitly marked as not yet saved.
  await expect(card.getByText(/nothing is saved until you add it/i)).toBeVisible();

  // Nothing has been scheduled: Monday is still empty, exactly as it was before
  // the button was pressed. This is the anti-friction contract.
  await expect(dayColumn(page, "Monday").getByText("No dinner planned")).toBeVisible();

  await card.getByRole("button", { name: "Add to my week" }).click();

  // Accepted: the proposal clears and the week is filled. WHICH recipe lands on
  // Monday is deliberately not asserted — with an empty pantry every candidate
  // scores the same and the ranker breaks the tie on recipe id, which is
  // generated. That the day stopped being empty is the claim that matters.
  await expect(card.getByRole("button", { name: "Add to my week" })).toHaveCount(0);
  await expect(dayColumn(page, "Monday").getByText("No dinner planned")).toHaveCount(0);
  await expect(dayColumn(page, "Monday").getByText(new RegExp(suffix))).toBeVisible();
});

test("regenerating leaves an already-planned day alone", async ({ page }) => {
  await signUp(page);

  const suffix = uniqueSuffix();
  const planned = `Planned Salmon ${suffix}`;
  const other = `Other Beef ${suffix}`;
  await createRecipeAndAddToBasket(page, planned, { quantity: "1", unit: "lb", item: "salmon" });
  await createRecipeAndAddToBasket(page, other, { quantity: "1", unit: "lb", item: "beef" });

  // Plan Wednesday by hand first — this is the meal that must survive.
  await navigateTo(page, "Plan");
  const railRow = page.getByRole("listitem").filter({ hasText: planned });
  await expect(railRow).toBeVisible();
  await railRow.getByRole("button", { name: "Wednesday" }).click();
  await expect(dayColumn(page, "Wednesday").getByText(planned)).toBeVisible();

  const card = suggester(page);
  await card.getByRole("button", { name: "Suggest my week" }).click();

  // The suggester says which day it will not touch, and does not touch it.
  await expect(card.getByText(/Left alone: Wednesday/)).toBeVisible();
  await card.getByRole("button", { name: "Add to my week" }).click();

  await expect(dayColumn(page, "Wednesday").getByText(planned)).toBeVisible();
});
