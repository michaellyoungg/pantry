import { expect, type Page, test } from "@playwright/test";
import {
  createRecipeAndAddToBasket,
  groceryLine,
  myRecipeRow,
  navigateTo,
  pantryRow,
  planRailRow,
  signUp,
  uniqueSuffix,
} from "./helpers";

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
  const planRow = planRailRow(page, base);
  await expect(planRow).toBeVisible();
  await planRow.getByRole("button", { name: "Monday" }).click();
  // Wait for the scheduling write to land before generating: the aggregation
  // reads the plan server-side, so firing it against an unscheduled week comes
  // back with an empty list and the failure surfaces far from its cause.
  await expect(page.getByRole("button", { name: `Remove ${base} from Monday` })).toBeVisible();
  await page.getByRole("button", { name: "Generate grocery list" }).click();

  await navigateTo(page, "List");
  const line = groceryLine(page, /garlic/i);
  await expect(line).toBeVisible();
  await line.getByRole("checkbox").check();

  // A second recipe sharing the ingredient, never added to the basket so it
  // stays an eligible candidate. Owned by this user, which keeps the assertion
  // below independent of the catalog's contents; the catalog half of the
  // candidate pool is asserted separately at the end of the test.
  const title = `Garlic Toast ${uniqueSuffix()}`;
  await navigateTo(page, "Recipes");
  await page.getByPlaceholder("Title").fill(title);
  await page.getByRole("spinbutton").first().fill("1");
  await page.getByPlaceholder("unit").first().fill("clove");
  await page.getByPlaceholder("item").first().fill("garlic");
  await page.getByRole("button", { name: "Create recipe" }).click();
  await expect(myRecipeRow(page, title)).toBeVisible();

  // The pantry now holds garlic. Mark it to use up.
  //
  // Scoped to the inventory ROW: since BL-0050 the suggestions card sits ABOVE
  // the inventory and its recipe rows mention garlic too, so a text filter over
  // the page picks a suggestion as readily as an inventory row. The row's id
  // says which is meant; the button inside it keeps its accessible name.
  await navigateTo(page, "Pantry");
  const markUseUp = pantryRow(page, /garlic/i).getByRole("button", { name: /to use up/i });
  await expect(markUseUp).toBeVisible();
  await markUseUp.click();

  // Ask for suggestions. Assert on the "Uses up:" reason specifically, not just
  // any reason: it is the one string only the useItUp feature can produce, so it
  // proves the use-up flag actually drove the score rather than plain overlap.
  // No button: the card loads on its own when /pantry opens (BL-0050).
  const row = suggestions(page).getByRole("listitem").filter({ hasText: title });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row.getByText(/Uses up:/)).toBeVisible();

  // The candidate pool is the user's recipes PLUS the shared catalog, and the
  // catalog half only exists here because scripts/e2e.sh seeds it (BL-0051).
  // "Spaghetti Aglio e Olio" is a seeded recipe whose ingredients include
  // garlic, so a break in the catalog leg of recommendCandidates — an empty
  // seed, a user-scoped lookup, a dropped source — takes this assertion with it
  // while the user-owned suggestion above keeps passing.
  const fromCatalog = suggestions(page)
    .getByRole("listitem")
    .filter({ hasText: "Spaghetti Aglio e Olio" });
  await expect(fromCatalog).toBeVisible();
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
  const baseRow = planRailRow(page, base);
  await expect(baseRow).toBeVisible();
  await baseRow.getByRole("button", { name: "Monday" }).click();
  await expect(page.getByRole("button", { name: `Remove ${base} from Monday` })).toBeVisible();
  await page.getByRole("button", { name: "Generate grocery list" }).click();

  await navigateTo(page, "List");
  const garlicLine = groceryLine(page, /garlic/i);
  await expect(garlicLine).toBeVisible();
  await garlicLine.getByRole("checkbox").check();

  // The peanut recipe: two ingredient rows, added with the "+ ingredient"
  // button. Never added to the basket, so it stays an eligible candidate.
  //
  // Its allergen ingredient is deliberately NOT the word the avoid entry uses:
  // it says "creamy peanut butter", and the entry below says "peanut". Nothing
  // matches on that pair unless the entry is canonicalized to the peanut
  // allergen family and the recipe text is canonicalized to a member of it
  // (BL-0052). The identity case — same word both sides — passed for years
  // while the feature did not work.
  const title = `Peanut Garlic ${uniqueSuffix()}`;
  await navigateTo(page, "Recipes");
  await page.getByPlaceholder("Title").fill(title);
  await page.getByRole("spinbutton").first().fill("2");
  await page.getByPlaceholder("unit").first().fill("cloves");
  await page.getByPlaceholder("item").first().fill("garlic");
  await page.getByRole("button", { name: "+ ingredient" }).click();
  await page.getByRole("spinbutton").last().fill("2");
  await page.getByPlaceholder("unit").last().fill("tbsp");
  await page.getByPlaceholder("item").last().fill("creamy peanut butter");
  await page.getByRole("button", { name: "Create recipe" }).click();
  await expect(myRecipeRow(page, title)).toBeVisible();

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
  await expect(myRecipeRow(page, control)).toBeVisible();

  // BASELINE: with no avoid list, both recipes surface.
  await navigateTo(page, "Pantry");
  await expect(suggestions(page).getByText(title)).toBeVisible({ timeout: 15_000 });
  await expect(suggestions(page).getByText(control)).toBeVisible();

  // Now avoid peanut and confirm it disappears.
  //
  // Scoped to the Preferences card: /settings also hosts BL-0038's nutrition
  // goals, whose "Add a goal" card has its own "Add" button, so an unscoped
  // getByRole("button", { name: "Add" }) matches two elements and throws.
  await navigateTo(page, "Settings");
  const prefs = page.locator("section").filter({ hasText: "Preferences" });
  await prefs.getByPlaceholder("Ingredient to avoid").fill("peanut");
  await prefs.getByRole("button", { name: "Add" }).click();
  // The entry is resolved through the dictionary before it is stored, so the
  // chip carries the family's display name rather than the typed text, and the
  // note says what the family covers. Both are the user-visible proof that
  // something was actually matched.
  await expect(
    prefs
      .getByRole("list", { name: "Ingredients you avoid" })
      .getByRole("listitem")
      .filter({ hasText: "Peanuts" }),
  ).toBeVisible();
  await expect(prefs.getByText(/also removes recipes with/i)).toBeVisible();

  await navigateTo(page, "Pantry");
  await expect(suggestions(page).getByText(control)).toBeVisible({ timeout: 15_000 });
  await expect(suggestions(page).getByText(title)).toHaveCount(0);
});

// The silent-no-match case, in a real browser against the real dictionary.
//
// It gets its own test rather than an assertion tacked onto the one above,
// because it is the failure the whole feature turns on: an avoid entry that
// matches nothing looked exactly like one that worked, and a user with an
// allergy had no way to tell which they had.
test("says plainly when an avoid entry matches no known ingredient", async ({ page }) => {
  await signUp(page);
  await navigateTo(page, "Settings");

  const prefs = page.locator("section").filter({ hasText: "Preferences" });
  await prefs.getByPlaceholder("Ingredient to avoid").fill("unobtainium");
  await prefs.getByRole("button", { name: "Add" }).click();

  await expect(prefs.getByText(/doesn’t match any ingredient we know/i)).toBeVisible();

  // A typed synonym, by contrast, is resolved and says so.
  await prefs.getByPlaceholder("Ingredient to avoid").fill("scallion");
  await prefs.getByRole("button", { name: "Add" }).click();
  await expect(
    prefs
      .getByRole("list", { name: "Ingredients you avoid" })
      .getByRole("listitem")
      .filter({ hasText: "Green onion" }),
  ).toBeVisible();
});
