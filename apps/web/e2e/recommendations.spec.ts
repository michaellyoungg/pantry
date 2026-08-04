import { expect, type Page, test } from "@playwright/test";
import { createRecipeAndAddToBasket, navigateTo, signUp, uniqueSuffix } from "./helpers";

/**
 * The one "use it up" card on /pantry.
 *
 * BL-0050 merged the two cards that used to live here — the expiry-driven one
 * and the preference-driven one — so this locator no longer has to disambiguate
 * them. It stays scoped to the section because /pantry also renders the pantry
 * inventory, whose rows mention the same ingredients.
 */
function suggestions(page: Page) {
  return page.getByRole("region", { name: "Use it up" });
}

test("suggests a recipe for a pantry item marked to use up", async ({ page }) => {
  await signUp(page);

  // Build a recipe, plan it, and shop it — checking the line off is what puts
  // the ingredient in the pantry (BL-0021 inflow).
  //
  // The ingredient must be "garlic" because it is a canonical item in
  // normalization.json; the pantry stores canonical keys, so an item the
  // dictionary doesn't know would never match a candidate's ingredients.
  const base = `Garlic Base ${uniqueSuffix()}`;
  await createRecipeAndAddToBasket(page, base, { quantity: "2", unit: "cloves", item: "garlic" });

  await navigateTo(page, "Plan");
  const planRow = page.getByRole("listitem").filter({ hasText: base });
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

  // A second recipe sharing the ingredient, never added to the basket so it
  // stays an eligible candidate. It has to be a recipe of the user's own: the
  // shared catalog would be the realistic source of a suggestion here, but
  // scripts/e2e.sh never runs cmd/seed, so the catalog table is empty in this
  // environment and a catalog-dependent assertion could never pass.
  const title = `Garlic Toast ${uniqueSuffix()}`;
  await navigateTo(page, "Recipes");
  await page.getByPlaceholder("Title").fill(title);
  await page.getByRole("spinbutton").first().fill("1");
  await page.getByPlaceholder("unit").first().fill("clove");
  await page.getByPlaceholder("item").first().fill("garlic");
  await page.getByRole("button", { name: "Create recipe" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: title })).toBeVisible();

  // The pantry now holds garlic. Mark it to use up.
  //
  // Targeted by the BUTTON's own label rather than by finding a listitem that
  // mentions garlic: since BL-0050 the suggestions card sits ABOVE the
  // inventory and its recipe rows are listitems mentioning garlic too, so
  // `.first()` on a text filter picks a suggestion, which has no such button.
  // Only inventory rows carry "Mark … to use up", so this is unambiguous.
  await navigateTo(page, "Pantry");
  const markUseUp = page.getByRole("button", { name: /Mark .*garlic.* to use up/i });
  await expect(markUseUp).toBeVisible();
  await markUseUp.click();

  // Ask for suggestions. Assert on the "Uses up:" reason specifically, not just
  // any reason: it is the one string only the useItUp feature can produce, so it
  // proves the use-up flag actually drove the score rather than plain overlap.
  // No button: the card loads on its own when /pantry opens (BL-0050).
  const row = suggestions(page).getByRole("listitem").filter({ hasText: title });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row.getByText(/Uses up:/)).toBeVisible();
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

  // A control recipe with no peanut in it. The avoid list must not touch this
  // one, which is what makes the negative assertion below meaningful: navigating
  // back to /pantry remounts the card with no results, so `toHaveCount(0)` on
  // its own would pass instantly — before the request even returns — and would
  // prove nothing. Waiting for the control to reappear proves a real response
  // was rendered, and only then is the peanut recipe's absence evidence.
  const control = `Garlic Control ${uniqueSuffix()}`;
  await page.getByPlaceholder("Title").fill(control);
  await page.getByRole("spinbutton").first().fill("1");
  await page.getByPlaceholder("unit").first().fill("clove");
  await page.getByPlaceholder("item").first().fill("garlic");
  await page.getByRole("button", { name: "Create recipe" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: control })).toBeVisible();

  // BASELINE: with no avoid list, both recipes surface.
  await navigateTo(page, "Pantry");
  await expect(suggestions(page).getByText(title)).toBeVisible({ timeout: 15_000 });
  await expect(suggestions(page).getByText(control)).toBeVisible();

  // Now avoid peanut and confirm it disappears.
  //
  // Scoped to the Preferences card: /settings also hosts BL-0038's nutrition
  // goals, whose "Add a goal" card has its own "Add" button, so an unscoped
  // getByRole("button", { name: "Add" }) matches two elements and throws.
  await page.goto("/settings");
  const prefs = page.locator("section").filter({ hasText: "Preferences" });
  await prefs.getByPlaceholder("Ingredient to avoid").fill("peanut");
  await prefs.getByRole("button", { name: "Add" }).click();
  await expect(prefs.getByText("peanut")).toBeVisible();

  await navigateTo(page, "Pantry");
  await expect(suggestions(page).getByText(control)).toBeVisible({ timeout: 15_000 });
  await expect(suggestions(page).getByText(title)).toHaveCount(0);
});
