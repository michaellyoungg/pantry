import { expect, test } from "@playwright/test";
import {
  createRecipeAndAddToBasket,
  groceryLine,
  navigateTo,
  scheduleAndGenerate,
  signUp,
  uniqueSuffix,
} from "./helpers";

// Two cross-service guarantees that unit tests can't prove end to end:
//   1. Ingredient aggregation — two recipes that each call for garlic must
//      collapse into ONE grocery line (recipe-service normalization, BL-0003).
//   2. Per-user isolation — a brand-new account sees none of another user's
//      data (the real-auth boundary, BL-0004).
test("aggregates ingredients across recipes and isolates data per user", async ({ page }) => {
  const suffix = uniqueSuffix();
  const recipeA = `E2E Aggregate A ${suffix}`;
  const recipeB = `E2E Aggregate B ${suffix}`;

  // --- user A: two garlic recipes → one aggregated line --------------------
  await signUp(page);
  await createRecipeAndAddToBasket(page, recipeA, {
    quantity: "2",
    unit: "cloves",
    item: "garlic",
  });
  await createRecipeAndAddToBasket(page, recipeB, {
    quantity: "3",
    unit: "cloves",
    item: "garlic",
  });
  await scheduleAndGenerate(page, [
    { title: recipeA, day: "Monday" },
    { title: recipeB, day: "Tuesday" },
  ]);

  // Nav link, not page.goto(): the generate action fired by
  // `scheduleAndGenerate` above is still in flight and a full load cancels it.
  await navigateTo(page, "List");
  // If aggregation works, both recipes' garlic merges into a single line; a
  // regression that stopped merging would show two garlic lines here.
  const garlicLines = groceryLine(page, "garlic");
  await expect(garlicLines).toHaveCount(1);

  // BL-0019: merging is only useful if it stays traceable — the one line has to
  // name both recipes it came from. This is the whole provenance chain in one
  // assertion: Go aggregation → persisted sources → the sheet.
  await garlicLines.getByRole("button", { name: /2 recipes/i }).click();
  const provenance = page.getByRole("dialog");
  await expect(provenance.getByRole("link", { name: recipeA })).toBeVisible();
  await expect(provenance.getByRole("link", { name: recipeB })).toBeVisible();
  await provenance.getByRole("button", { name: "Close" }).click();
  await expect(provenance).toBeHidden();

  // --- sign out returns to the auth gate -----------------------------------
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByTestId("auth-form")).toBeVisible();

  // --- user B: a fresh account starts with an empty list -------------------
  await signUp(page);
  await page.goto("/list");
  await expect(page.getByText(/Nothing yet — generate from your basket/)).toBeVisible();
  // Scoped to the grocery card: asserting the whole document has no listitems
  // makes an isolation test hostage to any future <li> anywhere in the shell.
  await expect(
    page.getByRole("region", { name: "Grocery list" }).getByRole("listitem"),
  ).toHaveCount(0);
});
