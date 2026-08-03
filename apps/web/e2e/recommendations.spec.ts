import { expect, test } from "@playwright/test";
import { createRecipeAndAddToBasket, navigateTo, signUp, uniqueSuffix } from "./helpers";

test("suggests a recipe for a pantry item marked to use up", async ({ page }) => {
  await signUp(page);

  // Build a recipe, plan it, and shop it — checking the line off is what puts
  // the ingredient in the pantry (BL-0021 inflow).
  //
  // The ingredient MUST be "garlic", not something arbitrary. This recipe ends
  // up in the basket, so it is excluded from its own results; the suggestion has
  // to come from the seeded catalog. Garlic appears in 4 of the 6 catalog
  // recipes AND is a canonical item in normalization.json. Picking an ingredient
  // absent from the catalog (rice, say) makes this test assert on a suggestion
  // that can never exist.
  const title = `Garlic Bowl ${uniqueSuffix()}`;
  await createRecipeAndAddToBasket(page, title, { quantity: "2", unit: "cloves", item: "garlic" });

  await navigateTo(page, "Plan");
  const planRow = page.getByRole("listitem").filter({ hasText: title });
  await expect(planRow).toBeVisible();
  await planRow.getByRole("button", { name: "Monday" }).click();
  await page.getByRole("button", { name: "Generate grocery list" }).click();

  await navigateTo(page, "List");
  const line = page
    .getByRole("listitem")
    .filter({ hasText: /garlic/i })
    .first();
  await expect(line).toBeVisible();
  await line.getByRole("checkbox").check();

  // The pantry now holds garlic. Mark it to use up.
  await navigateTo(page, "Pantry");
  const pantryRow = page
    .getByRole("listitem")
    .filter({ hasText: /garlic/i })
    .first();
  await expect(pantryRow).toBeVisible();
  await pantryRow.getByRole("button", { name: /Mark .* to use up/ }).click();

  // Ask for suggestions. The planned recipe is excluded, so a catalog recipe
  // sharing the ingredient is what should surface — assert on the reason text,
  // which proves scoring actually ran rather than a list being echoed back.
  await page.getByRole("button", { name: "What can I make?" }).click();
  await expect(
    page.getByText(/Uses up:|Uses \d+ things? you have|You have everything/).first(),
  ).toBeVisible({ timeout: 15_000 });
});

test("never suggests a recipe containing an avoided ingredient", async ({ page }) => {
  await signUp(page);

  // This test must first prove the recipe DOES surface, then prove the avoid
  // list removes it. Asserting only the absence would pass even if the filter
  // were entirely broken — a recipe sharing nothing with the pantry is dropped
  // for zero overlap anyway, so absence on its own proves nothing.
  //
  // Getting garlic into the pantry requires the check-off flow: the Pantry
  // screen has NO manual-add affordance, so the grocery list is the only inflow.
  // That means two recipes — a "base" one we shop (and which therefore lands in
  // the basket and is excluded from results), and the peanut one we never
  // basket, so it stays eligible.
  const base = `Garlic Base ${uniqueSuffix()}`;
  await createRecipeAndAddToBasket(page, base, { quantity: "2", unit: "cloves", item: "garlic" });

  await navigateTo(page, "Plan");
  const baseRow = page.getByRole("listitem").filter({ hasText: base });
  await expect(baseRow).toBeVisible();
  await baseRow.getByRole("button", { name: "Monday" }).click();
  await page.getByRole("button", { name: "Generate grocery list" }).click();

  await navigateTo(page, "List");
  const garlicLine = page
    .getByRole("listitem")
    .filter({ hasText: /garlic/i })
    .first();
  await expect(garlicLine).toBeVisible();
  await garlicLine.getByRole("checkbox").check();

  // The peanut recipe: two ingredient rows, added with the "+ ingredient"
  // button. Never added to the basket, so it stays an eligible candidate.
  const title = `Peanut Garlic ${uniqueSuffix()}`;
  await navigateTo(page, "Recipes");
  await page.getByPlaceholder("Title").fill(title);
  await page.getByRole("spinbutton").first().fill("2");
  await page.getByPlaceholder("unit").first().fill("cloves");
  await page.getByPlaceholder("item").first().fill("garlic");
  await page.getByRole("button", { name: "+ ingredient" }).click();
  await page.getByRole("spinbutton").last().fill("2");
  await page.getByPlaceholder("unit").last().fill("tbsp");
  await page.getByPlaceholder("item").last().fill("peanut");
  await page.getByRole("button", { name: "Create recipe" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: title })).toBeVisible();

  // BASELINE: with no avoid list, the recipe surfaces.
  await navigateTo(page, "Pantry");
  await page.getByRole("button", { name: "What can I make?" }).click();
  await expect(page.getByText(title)).toBeVisible({ timeout: 15_000 });

  // Now avoid peanut and confirm it disappears.
  await page.goto("/settings");
  await page.getByPlaceholder("Ingredient to avoid").fill("peanut");
  await page.getByRole("button", { name: "Add" }).click();
  await expect(page.getByText("peanut")).toBeVisible();

  await navigateTo(page, "Pantry");
  await page.getByRole("button", { name: "What can I make?" }).click();
  await expect(page.getByText(title)).toHaveCount(0);
});
