import { TEST_IDS } from "@pantry/core/testing";
import { expect, type Page } from "@playwright/test";

// Shared steps for the end-to-end specs. Each helper drives the real UI the way
// a user would.
//
// Selectors are mixed, on purpose (BL-0071). Roles, labels and visible text
// stay wherever they are working: they assert accessibility as a side effect
// and they fail loudly when the UI stops being reachable the way a user reaches
// it. What moved to `data-testid` is the *identity* of a repeated row — which
// grocery line, which recipe, which pantry item — because that is where
// role-based locators kept breaking: they described the DOM's shape, so a
// neighbouring card growing a list of its own turned one match into two and
// Playwright hard-failed on strict mode.
//
// The ids come from `@pantry/core/testing`, which is also where the native
// client's `testID`s come from, so a journey described here and a Maestro flow
// describing the same journey are pointing at the same elements rather than
// agreeing by convention.

/** A per-run token so parallel or repeated runs never collide on data. */
export function uniqueSuffix(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

/**
 * Register a brand-new account and wait for the authenticated shell. Returns the
 * credentials so a test can sign back in as the same user if it needs to.
 */
export async function signUp(page: Page): Promise<{ email: string; password: string }> {
  const email = `e2e-${uniqueSuffix()}@example.test`;
  const password = "e2e-password-1234";
  await page.goto("/");
  await expect(page.getByTestId(TEST_IDS.auth.form)).toBeVisible();
  // By id rather than by copy: every one of these controls is labelled with a
  // sentence ("Need an account? Sign up"), and this runs at the top of every
  // spec in the suite — a wording change should not be able to break all of
  // them at once. The native sign-in screen carries the same four ids.
  await page.getByTestId(TEST_IDS.auth.toggleFlow).click();
  await page.getByTestId(TEST_IDS.auth.email).fill(email);
  await page.getByTestId(TEST_IDS.auth.password).fill(password);
  await page.getByTestId(TEST_IDS.auth.submit).click();
  // The "Sign out" control only renders when authenticated.
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  return { email, password };
}

/**
 * Navigate the way a user does — by clicking the sidebar link.
 *
 * `page.goto()` is a full page load, which tears down the Convex websocket and
 * cancels any mutation still in flight (e.g. the `basket.add` fired one line
 * earlier, which has no visible confirmation on /recipes to wait for). Client-side
 * navigation keeps the socket open so the write completes.
 */
/**
 * The <h2> each nav destination renders, used as the "we have actually arrived"
 * barrier below. Keyed by the nav link's label.
 */
const ROUTE_HEADING: Record<string, string> = {
  Home: "Welcome to Pantry",
  Plan: "Plan your week",
  Recipes: "Recipes",
  List: "Grocery list",
  Pantry: "Pantry",
  History: "History",
  Settings: "Settings",
};

export async function navigateTo(page: Page, label: string): Promise<void> {
  const link = page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: label });
  await link.click();

  // Clicking only *schedules* the route change, and the caller's very next
  // locator must not be evaluated against the page we are leaving. Waiting is
  // not merely a tidiness thing: if the outgoing page happens to contain two
  // matches for the caller's text — /recipes lists a recipe in both
  // <RecipeList> and the "For you" panel above it — Playwright raises a
  // strict-mode violation, which is a hard error it does NOT retry away. So the
  // spec dies instead of waiting for the page it asked for. (BL-0070.)
  //
  // Two barriers, because the first alone is not enough. The router flips the
  // link's active state as soon as the location changes, but the route
  // components are lazily loaded, so the *previous* route's markup can still be
  // mounted at that point — we caught exactly that in a failure snapshot: the
  // Plan link already [active] while the DOM was still /recipes. Waiting for
  // the destination's own heading is what proves it rendered.
  await expect(link).toHaveAttribute("aria-current", "page");
  const heading = ROUTE_HEADING[label];
  if (heading) {
    // .first(): some pages repeat the name (the /recipes page heading and the
    // "Recipes" card heading), and the app header is an <h1> "Pantry", hence
    // the explicit level.
    await expect(
      page.getByRole("heading", { level: 2, name: heading, exact: true }).first(),
    ).toBeVisible();
  }
}

/**
 * Switch tabs inside the Recipes section ("My recipes" / "Browse catalog" /
 * "My kitchen"). Its sub-nav is a second <nav>, labelled "Recipes", so it needs
 * its own scope — `navigateTo` targets the app-level "Main" navigation and
 * would not find these links. Client-side for the same reason as `navigateTo`.
 */
/**
 * The card heading each Recipes tab's outlet renders. "My recipes" is keyed on
 * the create form rather than the recipe list, whose card is also titled
 * "Recipes" and would collide with the layout heading.
 */
const RECIPES_TAB_HEADING: Record<string, string> = {
  "My recipes": "New recipe",
  "Browse catalog": "Catalog",
  "My kitchen": "My Kitchen",
};

export async function navigateToRecipesTab(page: Page, label: string): Promise<void> {
  const link = page.getByRole("navigation", { name: "Recipes" }).getByRole("link", { name: label });
  await link.click();
  // Same barrier as `navigateTo`, and needed for the same reason. `data-active`
  // alone is not enough, and the trick `navigateTo` uses does not transfer:
  // routes/recipes.tsx renders its <h2>Recipes</h2> at the *layout* level, so
  // that heading is already on screen for every tab and proves nothing about
  // which outlet is mounted. Each tab's own card heading does.
  await expect(link).toHaveAttribute("data-active", "true");
  const heading = RECIPES_TAB_HEADING[label];
  if (heading) {
    await expect(page.getByRole("heading", { level: 2, name: heading, exact: true })).toBeVisible();
  }
}

/**
 * A row in the user's own recipe list on /recipes.
 *
 * /recipes renders the same recipe title twice — once in <RecipeList> and once
 * in the "For you" suggestions panel above it, which can recommend a recipe you
 * own. An unscoped `getByRole("listitem").filter({ hasText: title })` therefore
 * matched one or two elements depending on whether the suggestion query had
 * resolved yet, and the two-match case is a Playwright strict-mode violation —
 * a hard error, not something it retries away. That race is why the suite could
 * not be trusted at any worker count (BL-0070).
 *
 * The id says which row is meant instead of describing where it sits, so the
 * "For you" panel can render whatever it likes above it.
 */
export function myRecipeRow(page: Page, title: string) {
  return page.getByTestId(TEST_IDS.recipes.item(title));
}

/**
 * A row in the "Not yet planned" rail on /plan — a basket recipe waiting for a
 * day. Identified for the same reason as `myRecipeRow`: if the page we are
 * leaving is still mounted, this matches nothing and Playwright simply keeps
 * polling, whereas a text filter over the whole page can match two elements and
 * hard-fail.
 */
export function planRailRow(page: Page, title: string) {
  return page.getByTestId(TEST_IDS.plan.unplanned(title));
}

/**
 * Every line of the grocery walk, and nothing else on /list.
 *
 * The page is not only the grocery card: once a line has been checked off,
 * <LeftoverProposals> renders its own listitems naming the same ingredient, and
 * the pantry-shaped cards elsewhere do too. Matching on the row's own id stem
 * says "a grocery line" rather than "an <li> somewhere inside this region",
 * which is the distinction the old locator could not draw.
 */
export function groceryLines(page: Page) {
  return page.locator(`[data-testid^="${TEST_IDS.list.itemPrefix}"]`);
}

/**
 * One line of the grocery walk, matched by ingredient text.
 *
 * Text rather than `TEST_IDS.list.item(name)` because the ingredient's final
 * name is not this suite's to predict: `parseManualEntry` decides how much of
 * the input is the item, and the server then replaces it with the
 * normalization table's display form. The id stem narrows the search to
 * grocery lines; the text picks one out of them.
 */
export function groceryLine(page: Page, text: string | RegExp) {
  return groceryLines(page).filter({ hasText: text });
}

/**
 * A row of the pantry inventory on /pantry, matched by item text.
 *
 * Since BL-0050 the use-it-up suggestions card sits *above* the inventory and
 * its recipe rows mention the same ingredients, so a text filter over the page
 * picks a suggestion as readily as an inventory row. Specs used to work around
 * that by filtering for a row that also contained a state button; the id says
 * it directly.
 */
export function pantryRow(page: Page, text: string | RegExp) {
  return page.locator(`[data-testid^="${TEST_IDS.pantry.itemPrefix}"]`).filter({ hasText: text });
}

/** Create a manual recipe with one ingredient row and add it to the basket. */
export async function createRecipeAndAddToBasket(
  page: Page,
  title: string,
  ingredient: { quantity: string; unit: string; item: string },
): Promise<void> {
  // Nav link rather than page.goto(). A full load tears down the Convex socket
  // and cancels whatever is still in flight — and this helper is routinely
  // called twice in a row, where the second call would otherwise cancel the
  // `basket.add` fired at the end of the first. That write has no visible
  // confirmation on /recipes to wait for, so the only safe thing is not to drop
  // the socket. (BL-0070: the losing side of that race widens under load.)
  await navigateTo(page, "Recipes");
  await page.getByPlaceholder("Title").fill(title);
  await page.getByRole("spinbutton").first().fill(ingredient.quantity);
  await page.getByPlaceholder("unit").first().fill(ingredient.unit);
  await page.getByPlaceholder("item").first().fill(ingredient.item);
  await page.getByRole("button", { name: "Create recipe" }).click();

  const row = myRecipeRow(page, title);
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Add to basket" }).click();
}

/**
 * On the Plan page, schedule each basket recipe onto the matching day (DayPicker
 * buttons are aria-labelled by full weekday name), then generate the grocery list.
 */
export async function scheduleAndGenerate(
  page: Page,
  plan: Array<{ title: string; day: string }>,
): Promise<void> {
  await navigateTo(page, "Plan");
  for (const { title, day } of plan) {
    const row = planRailRow(page, title);
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: day }).click();
  }
  const generate = page.getByRole("button", { name: "Generate grocery list" });
  await expect(generate).toBeEnabled();
  await generate.click();
}
