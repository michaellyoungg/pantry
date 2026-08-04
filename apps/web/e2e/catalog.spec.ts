import { expect, test } from "@playwright/test";
import { navigateTo, navigateToRecipesTab, scheduleAndGenerate, signUp } from "./helpers";

// The shared catalog, end to end (BL-0051).
//
// `scripts/e2e.sh` now runs the catalog seed job, so this suite finally has the
// rows every other environment has. That matters because catalog recipes are
// the one corner of the app where a recipe the user did not write is planned,
// aggregated and shopped: they are owned by the `catalog` sentinel user, not by
// the caller, so every read on this path has to resolve a second ownership
// scope. A user-scoped lookup that "works" in unit tests silently returns
// nothing here — which is exactly the shape of the empty-grocery-list bug this
// path has already produced once.
//
// Titles and ingredients below are taken verbatim from
// apps/recipe-service/internal/recipe/catalog.json. `baguette` is deliberate:
// it appears in exactly one catalog recipe and in no recipe any other spec
// creates, so a line bearing it can only have come from the catalog.
const CATALOG_RECIPE = "Garlic Bread";
const CATALOG_ONLY_INGREDIENT = "baguette";

test("plans and shops a catalog recipe the user did not write", async ({ page }) => {
  // A break anywhere on this path tends to surface as a render crash rather
  // than a failed assertion, so watch for uncaught errors too.
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));

  await signUp(page);

  // Browse: GET /catalog through the Convex action, rendered by /recipes/catalog.
  await navigateTo(page, "Recipes");
  await navigateToRecipesTab(page, "Browse catalog");
  const row = page.getByRole("listitem").filter({ hasText: CATALOG_RECIPE });
  await expect(row).toBeVisible();

  // Add to basket: the write that stores a recipe id belonging to another user.
  await row.getByRole("button", { name: "Add to basket" }).click();

  // Plan + generate. Nav-link navigation, not page.goto(): the basket write
  // above has no visible confirmation on this screen, and a full page load
  // would cancel it mid-flight.
  await scheduleAndGenerate(page, [{ title: CATALOG_RECIPE, day: "Monday" }]);

  // The payoff: the aggregated list contains an ingredient that only exists in
  // the catalog copy of this recipe. If the aggregator resolved recipe ids in
  // the caller's scope alone, the basket would aggregate to an empty list and
  // this line would simply be absent.
  await navigateTo(page, "List");
  const line = page.getByRole("listitem").filter({ hasText: CATALOG_ONLY_INGREDIENT });
  await expect(line).toBeVisible();

  // And it is attributed to the catalog recipe, not merely present: provenance
  // is resolved from the same recipe lookup, so a scope bug that dropped the
  // title while keeping the quantity would show up right here.
  await line.getByRole("button", { name: /Show the 1 recipe this line came from/ }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText(CATALOG_RECIPE)).toBeVisible();

  expect(pageErrors, `Uncaught page errors:\n${pageErrors.join("\n")}`).toEqual([]);
});
