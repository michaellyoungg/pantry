import { expect, test } from "@playwright/test";
import {
  createRecipeAndAddToBasket,
  groceryLine,
  navigateTo,
  planRailRow,
  signUp,
  uniqueSuffix,
} from "./helpers";

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
  const row = planRailRow(page, title);
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
  // toHaveURL is satisfied before the lazily-loaded route mounts, so wait for
  // the destination card and scope to it rather than querying the whole page.
  const groceryCard = page.getByRole("region", { name: "Grocery list" });
  await expect(groceryCard).toBeVisible();
  await expect(groceryLine(page, "beans")).toBeVisible();

  // --- shopping: an unchecked list drives the shopping-day card ---
  await navigateTo(page, "Home");
  await expect(page.getByRole("heading", { name: "Shopping day" })).toBeVisible();
  await page.getByRole("link", { name: /^Shop 1 item$/ }).click();
  await expect(page).toHaveURL(/\/list$/);

  // --- shopped: everything checked closes the loop back to planning ---
  // Wait for the card, then name the line. `toHaveURL` above is satisfied the
  // moment the location changes, which is before the lazily-loaded route swaps
  // in — so an unscoped `getByRole("checkbox")` could still resolve against
  // Home, whose "Before you cook" card has checkboxes of its own, and ticking
  // one of those produced the memorably unhelpful "Clicking the checkbox did
  // not change its state". BL-0070 answered that by scoping to the card.
  //
  // Scoping was not the whole of it (BL-0074). `getByRole("checkbox").first()`
  // still took whichever checkbox existed at the instant the card appeared —
  // and the card appears before `getGroceryList` resolves, so the spec acted on
  // the first frame the list rendered, which is the same frame that inserts the
  // row being clicked. Naming the line through the shared selector contract
  // (BL-0071) says which row is meant instead of where it sits, and waiting for
  // it means the query has settled before anything is touched.
  await expect(groceryCard).toBeVisible();
  const beans = groceryLine(page, "beans");
  await expect(beans).toBeVisible();
  const beansCheckbox = beans.getByRole("checkbox");

  // click + expect rather than check(). They assert the same thing, but check()
  // reads the control's state ONCE, immediately after the click, and a false
  // reading is a non-retryable error. The tick is optimistic —
  // `groceryList.toggleItem` carries `.withOptimisticUpdate` — so the row is
  // unmounted out of its aisle and back in again while the 300ms cart
  // transition settles. Polling tells the two apart: a control one render
  // behind is not a control whose write never landed.
  await beansCheckbox.click();
  // The backend agreeing is a separate claim from the box looking ticked, and
  // this is the one that makes it. aria-busy on the card is
  // `useGroceryList().pending`, false again only once the mutation resolved,
  // and a rejected toggle would have taken the optimistic tick back with it —
  // so "settled AND still ticked" is the check-off having actually been stored.
  // Everything below depends on that: an unstored tick leaves Home in the
  // shopping state and the two assertions after the nav fail instead.
  await expect(groceryCard).toHaveAttribute("aria-busy", "false");
  await expect(beansCheckbox).toBeChecked();

  await navigateTo(page, "Home");
  await expect(page.getByRole("link", { name: "Plan next week" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Getting started" })).toBeHidden();
});
