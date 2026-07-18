import { expect, test } from "@playwright/test";
import { createRecipeAndAddToBasket, navigateTo, signUp, uniqueSuffix } from "./helpers";

// Home's state machine (BL-0017) is derived from live Convex queries, so the
// transitions only really hold against a real backend: the build-list CTA runs the
// recipe-service aggregation through a Convex action, and every other transition
// depends on Convex reactivity pushing the new plan/list down to an open page.
test("Home walks the weekly loop from empty to shopped", async ({ page }) => {
  await signUp(page);

  // --- empty: nothing planned, nothing to shop ---
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Plan this week" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Getting started" })).toBeVisible();

  // --- planned: a meal is in the week, no list yet ---
  const title = `Home Chili ${uniqueSuffix()}`;
  await createRecipeAndAddToBasket(page, title, { quantity: "2", unit: "cup", item: "beans" });

  await navigateTo(page, "Plan");
  const row = page.getByRole("listitem").filter({ hasText: title });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Monday" }).click();
  // Wait for the scheduling mutation to land before navigating — leaving the page
  // with the write still in flight cancels it. The remove control only renders
  // once the meal sits in a day column.
  await expect(page.getByRole("button", { name: `Remove ${title} from Monday` })).toBeVisible();

  await navigateTo(page, "Home");
  // The week strip reflects the schedule…
  await expect(page.getByRole("link", { name: `Monday — ${title}` })).toBeVisible();
  // …and the CTA counts meals, not grocery lines (the list doesn't exist yet).
  const build = page.getByRole("button", { name: "Build grocery list (1 meal)" });
  await expect(build).toBeVisible();

  // --- the handoff: generate in place, land on the list ---
  await build.click();
  await expect(page).toHaveURL(/\/list$/);
  const item = page.getByRole("listitem").filter({ hasText: "beans" });
  await expect(item).toBeVisible();

  // --- shopping: an unchecked list drives the shopping-day card ---
  await navigateTo(page, "Home");
  await expect(page.getByRole("heading", { name: "Shopping day" })).toBeVisible();
  await page.getByRole("link", { name: /^Shop 1 item$/ }).click();
  await expect(page).toHaveURL(/\/list$/);

  // --- shopped: everything checked closes the loop back to planning ---
  await page.getByRole("checkbox").first().check();
  await navigateTo(page, "Home");
  await expect(page.getByRole("link", { name: "Plan next week" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Getting started" })).toBeHidden();
  // …and the loop stays open: a finished list is never cleared, so Home must still
  // offer a way to build the next one rather than dead-ending on "Shopping done".
  await expect(page.getByRole("button", { name: "Rebuild grocery list" })).toBeVisible();
});
