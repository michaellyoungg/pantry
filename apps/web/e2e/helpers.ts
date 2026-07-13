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

/** Create a manual recipe with one ingredient row and add it to the basket. */
export async function createRecipeAndAddToBasket(
  page: Page,
  title: string,
  ingredient: { quantity: string; unit: string; item: string },
): Promise<void> {
  await page.goto("/recipes");
  await page.getByPlaceholder("Title").fill(title);
  await page.getByRole("spinbutton").first().fill(ingredient.quantity);
  await page.getByPlaceholder("unit").first().fill(ingredient.unit);
  await page.getByPlaceholder("item").first().fill(ingredient.item);
  await page.getByRole("button", { name: "Create recipe" }).click();

  const row = page.getByRole("listitem").filter({ hasText: title });
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
  await page.goto("/plan");
  for (const { title, day } of plan) {
    const row = page.getByRole("listitem").filter({ hasText: title });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: day }).click();
  }
  const generate = page.getByRole("button", { name: "Generate grocery list" });
  await expect(generate).toBeEnabled();
  await generate.click();
}
