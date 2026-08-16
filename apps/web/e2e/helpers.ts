import { expect, type Page } from "@playwright/test";

// Shared steps for the end-to-end specs. Each helper drives the real UI the way
// a user would; selectors target visible text / roles / aria-labels (the app has
// almost no test ids by design).

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
  await expect(page.getByTestId("auth-form")).toBeVisible();
  await page.getByRole("button", { name: "Need an account? Sign up" }).click();
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(password);
  await page.getByRole("button", { name: "Sign up" }).click();
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
 * Scoped deliberately. /recipes renders the same recipe title twice — once in
 * <RecipeList> and once in the "For you" suggestions panel above it, which can
 * recommend a recipe you own. An unscoped
 * `getByRole("listitem").filter({ hasText: title })` therefore matches one or
 * two elements depending on whether the suggestion query has resolved yet, and
 * the two-match case is a Playwright strict-mode violation — a hard error, not
 * something it retries away. That race is why the suite could not be trusted at
 * any worker count (BL-0070).
 */
export function myRecipeRow(page: Page, title: string) {
  return page
    .getByRole("list", { name: "My recipes" })
    .getByRole("listitem")
    .filter({ hasText: title });
}

/**
 * A row in the "Not yet planned" rail on /plan — a basket recipe waiting for a
 * day. Scoped for the same reason as `myRecipeRow`: if the page we are leaving
 * is still mounted, a scoped locator matches nothing and Playwright simply keeps
 * polling, whereas the unscoped one can match two elements and hard-fail.
 */
export function planRailRow(page: Page, title: string) {
  return page
    .getByRole("list", { name: "Not yet planned" })
    .getByRole("listitem")
    .filter({ hasText: title });
}

/**
 * A line in the grocery card on /list, matched by ingredient text.
 *
 * Scoped because /list is not only the grocery card: once a line has been
 * checked off, <LeftoverProposals> renders listitems naming the same
 * ingredient, so an unscoped filter starts matching two elements — a
 * strict-mode violation, which is a hard error rather than a retried poll.
 */
export function groceryLine(page: Page, text: string | RegExp) {
  return page
    .getByRole("region", { name: "Grocery list" })
    .getByRole("listitem")
    .filter({ hasText: text });
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
