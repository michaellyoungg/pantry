import { expect, test } from "@playwright/test";
import { createRecipeAndAddToBasket, scheduleAndGenerate, signUp, uniqueSuffix } from "./helpers";

// The core cross-service loop, in a real browser against a live stack:
//   sign up → create a recipe → add to basket → plan a day →
//   generate the aggregated grocery list → check an item off → reload persists.
//
// This exercises the seams unit tests + typecheck cannot: Convex Auth over the
// self-hosted backend, Convex reactivity, the Convex→recipe-service HTTP
// aggregation, and the controlled-checkbox round-trip. Each run signs up a
// fresh unique account, so it is self-isolating — real per-user scoping (BL-0004)
// replaces the old shared-DEV_USER_ID reset dance.
test("full loop: sign up, plan a recipe, generate list, check off, persist", async ({ page }) => {
  const recipeTitle = `E2E Garlic Bread ${uniqueSuffix()}`;

  // Fail the test on any uncaught page exception — the loop should be clean.
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));

  await signUp(page);
  await createRecipeAndAddToBasket(page, recipeTitle, {
    quantity: "3",
    unit: "cloves",
    item: "garlic",
  });
  await scheduleAndGenerate(page, [{ title: recipeTitle, day: "Monday" }]);

  // Grocery list: check off, then confirm it persists across a reload.
  await page.goto("/list");
  const item = page.getByRole("listitem").filter({ hasText: "garlic" });
  await expect(item).toBeVisible();
  const checkbox = item.getByRole("checkbox");
  await expect(checkbox).not.toBeChecked();
  await checkbox.check();
  await expect(checkbox).toBeChecked();

  // Reload: the checked state is server-persisted (Convex), not just local.
  await page.reload();
  const itemAfterReload = page.getByRole("listitem").filter({ hasText: "garlic" });
  await expect(itemAfterReload.getByRole("checkbox")).toBeChecked();

  expect(pageErrors, `Uncaught page errors during the loop:\n${pageErrors.join("\n")}`).toEqual([]);
});
