import { TEST_IDS } from "@pantry/core/testing";
import { expect, test } from "@playwright/test";
import {
  createRecipeAndAddToBasket,
  groceryLine,
  navigateTo,
  scheduleAndGenerate,
  signUp,
  uniqueSuffix,
} from "./helpers";

// BL-0019, the remaining increments: the grocery list is read one-handed in a
// shop, so the top of it has to stay "what's left" and the trip has to be
// closeable. These are the seams unit tests cannot reach — the aisle sections
// are built from the Go aggregator's real output, the check-off round-trips
// through Convex, and "Done shopping" is a real delete the reload has to agree
// with.

test("aisle sections fold, checked lines move to In cart, and the trip closes", async ({
  page,
}) => {
  const recipeTitle = `E2E Aisle Walk ${uniqueSuffix()}`;

  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));

  await signUp(page);
  await createRecipeAndAddToBasket(page, recipeTitle, {
    quantity: "3",
    unit: "cloves",
    item: "garlic",
  });
  await scheduleAndGenerate(page, [{ title: recipeTitle, day: "Monday" }]);
  // Nav link, not page.goto(): goto tears down the Convex socket and would
  // cancel the generate action fired on the line above.
  await navigateTo(page, "List");

  // The aisle header is a real control, and it says how much is in the aisle.
  const aisle = page.getByRole("button", { name: /,\s*\d+ items? to buy$/ }).first();
  await expect(aisle).toBeVisible();
  await expect(aisle).toHaveAttribute("aria-expanded", "true");

  const garlic = groceryLine(page, "garlic");
  await expect(garlic).toBeVisible();

  // Folding takes the aisle's lines with it, and unfolding brings them back.
  await aisle.click();
  await expect(aisle).toHaveAttribute("aria-expanded", "false");
  await expect(garlic).toBeHidden();
  await aisle.click();
  await expect(garlic).toBeVisible();

  // Ticking a line moves it out of the walk and into "In cart" — the point of
  // the whole section, so the top of the list is only ever what is left.
  //
  // click + expect rather than check(), and then a wait on the card settling.
  // The tick is optimistic (`groceryList.toggleItem` carries
  // `.withOptimisticUpdate`), so the row moves sections before the server has
  // seen anything and check()'s single, non-retryable state read can catch it
  // mid-move. aria-busy is `useGroceryList().pending`: false again only once the
  // mutation resolved, and a rejection would have taken the tick back with it,
  // so this is where the check-off is known to have been stored (BL-0074).
  const garlicCheckbox = garlic.getByRole("checkbox");
  await garlicCheckbox.click();
  await expect(page.getByRole("region", { name: "Grocery list" })).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(garlicCheckbox).toBeChecked();

  const inCart = page.getByRole("button", { name: /^In cart, \d+ items?$/ });
  await expect(inCart).toBeVisible();
  const inCartSection = page.getByTestId(TEST_IDS.list.inCartSection);
  await expect(inCartSection.getByRole("listitem").filter({ hasText: "garlic" })).toBeVisible();

  // The thumb-zone bar tracks the trip.
  await expect(page.getByTestId(TEST_IDS.list.progress)).toHaveText(/^\d+ of \d+ in cart$/);

  // Closing the trip: what was bought goes, because check-off already put it in
  // the pantry.
  await page.getByTestId(TEST_IDS.list.doneShopping).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  await sheet.getByRole("button", { name: "Keep what I didn't buy" }).click();

  await expect(groceryLine(page, "garlic")).toHaveCount(0);

  // Re-mounted from the server rather than reloaded: the assertion above is
  // satisfied by the optimistic update, and a reload here would tear down the
  // socket and cancel the very mutation being verified. Client-side navigation
  // keeps it open, so coming back re-renders from what the server actually has.
  await navigateTo(page, "Plan");
  await navigateTo(page, "List");
  await expect(groceryLine(page, "garlic")).toHaveCount(0);

  expect(pageErrors, `Uncaught page errors:\n${pageErrors.join("\n")}`).toEqual([]);
});

test("a manual line can be removed and put back with undo", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));

  await signUp(page);
  await page.goto("/list");

  // The add field lives in the thumb zone, behind one always-reachable control.
  // By id: the control's label is also its state ("Add item" / "Close"), so a
  // spec that names it is asserting the copy on the way past.
  await page.getByTestId(TEST_IDS.list.addToggle).click();
  await page.getByLabel("Add an item").fill("2 rolls foil");
  await page.getByRole("button", { name: "Add", exact: true }).click();

  const foil = groceryLine(page, /foil/i);
  await expect(foil).toBeVisible();

  // Removal is offered as an ordinary button — the swipe only ever accelerates
  // something already reachable.
  //
  // Matched on "Remove …" rather than the exact item, because the item name is
  // decided by two layers this test does not own: `parseManualEntry` only lifts
  // out recipe-service's convertible units (so "rolls" stays part of the name),
  // and the server then replaces the name with the normalization table's
  // display form. Pinning the result here asserts their content, not this
  // feature.
  await foil.getByRole("button", { name: /^Remove / }).click();
  await expect(groceryLine(page, /foil/i)).toHaveCount(0);

  // ...and it is undoable, with the line's own state intact.
  await expect(page.getByTestId(TEST_IDS.list.undo)).toHaveText(/^Removed /);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(groceryLine(page, /foil/i)).toBeVisible();

  expect(pageErrors, `Uncaught page errors:\n${pageErrors.join("\n")}`).toEqual([]);
});
