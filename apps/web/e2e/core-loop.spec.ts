import { expect, test } from "@playwright/test";

// The core cross-service loop, in a real browser against a live stack:
//   sign up → create a recipe → add to basket → plan a day →
//   generate the aggregated grocery list → check an item off → reload persists.
//
// This exercises the seams unit tests + typecheck cannot: Convex Auth over the
// self-hosted backend, Convex reactivity, the Convex→recipe-service HTTP
// aggregation, and the controlled-checkbox round-trip. Each run signs up a
// fresh unique account, so it is self-isolating — real per-user scoping (BL-0004)
// replaces the old shared-DEV_USER_ID reset dance.
test("full loop: sign up, plan a recipe, generate list, check off, persist", async ({ page }) => {
  // Unique-per-run identity + recipe title so parallel/repeat runs never collide.
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const email = `e2e-${stamp}@example.test`;
  const password = "e2e-password-1234";
  const recipeTitle = `E2E Garlic Bread ${stamp}`;

  // Fail the test on any uncaught page exception — the loop should be clean.
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));

  // --- sign up -------------------------------------------------------------
  await page.goto("/");
  await expect(page.getByTestId("auth-form")).toBeVisible();
  await page.getByRole("button", { name: "Need an account? Sign up" }).click();
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(password);
  await page.getByRole("button", { name: "Sign up" }).click();
  // Authenticated shell: the "Sign out" control only renders when signed in.
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();

  // --- create a recipe -----------------------------------------------------
  await page.goto("/recipes");
  await page.getByPlaceholder("Title").fill(recipeTitle);
  // First ingredient row: quantity (number) / unit / item.
  await page.getByRole("spinbutton").first().fill("3");
  await page.getByPlaceholder("unit").first().fill("cloves");
  await page.getByPlaceholder("item").first().fill("garlic");
  await page.getByRole("button", { name: "Create recipe" }).click();

  // It appears in the list; add it to the basket.
  const recipeRow = page.getByRole("listitem").filter({ hasText: recipeTitle });
  await expect(recipeRow).toBeVisible();
  await recipeRow.getByRole("button", { name: "Add to basket" }).click();

  // --- plan the week + generate the grocery list ---------------------------
  await page.goto("/plan");
  const planRow = page.getByRole("listitem").filter({ hasText: recipeTitle });
  await expect(planRow).toBeVisible();
  // Put the dinner on Monday (DayPicker buttons are aria-labelled by full day).
  await planRow.getByRole("button", { name: "Monday" }).click();

  const generate = page.getByRole("button", { name: "Generate grocery list" });
  await expect(generate).toBeEnabled();
  await generate.click();

  // --- grocery list: check off, then confirm it persists across a reload ---
  await page.goto("/list");
  const item = page.getByRole("listitem").filter({ hasText: "garlic" });
  await expect(item).toBeVisible();
  const checkbox = item.getByRole("checkbox");
  await expect(checkbox).not.toBeChecked();
  await checkbox.check();
  await expect(checkbox).toBeChecked();

  // Reload: the checked state is server-persisted (Convex), not just local.
  await page.reload();
  const itemAfterReload = page.getByRole("listitem").filter({ hasText: "garlic" });
  await expect(itemAfterReload.getByRole("checkbox")).toBeChecked();

  expect(pageErrors, `Uncaught page errors during the loop:\n${pageErrors.join("\n")}`).toEqual([]);
});
