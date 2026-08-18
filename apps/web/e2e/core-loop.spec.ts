import { expect, test } from "@playwright/test";
import {
  createRecipeAndAddToBasket,
  groceryLine,
  navigateTo,
  pantryRow,
  scheduleAndGenerate,
  signUp,
  uniqueSuffix,
} from "./helpers";

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
  const recipeTitle = `E2E Garlic Bread ${uniqueSuffix()}`;

  // Fail the test on any uncaught page exception — the loop should be clean.
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));

  await signUp(page);
  await createRecipeAndAddToBasket(page, recipeTitle, {
    quantity: "3",
    unit: "cloves",
    item: "garlic",
  });
  await scheduleAndGenerate(page, [{ title: recipeTitle, day: "Monday" }]);

  // Grocery list: check off, then confirm it persists across a reload.
  // Nav link, not page.goto(): `scheduleAndGenerate` fires the generate action
  // on its last line and a full load would cancel it.
  await navigateTo(page, "List");
  // Scoped to the grocery card. Once a line is checked off, <LeftoverProposals>
  // renders its own listitems naming the same ingredient, so an unscoped filter
  // matches two elements and hard-fails on a strict-mode violation.
  const item = groceryLine(page, "garlic");
  await expect(item).toBeVisible();
  const checkbox = item.getByRole("checkbox");
  await expect(checkbox).not.toBeChecked();
  await checkbox.check();
  await expect(checkbox).toBeChecked();

  // That tick proves nothing on its own: `groceryList.toggleItem` carries an
  // optimistic update, so the box flips locally before the server has seen the
  // mutation. Reloading here is a full load, which drops the Convex socket and
  // cancels anything not yet flushed — the write the next assertion is about.
  // aria-busy clears when the mutation is acknowledged, so it is the barrier
  // that makes the reload meaningful. (BL-0070: this lost race is rare on an
  // idle machine and common under parallel load, which is exactly the kind of
  // flake that made the suite untrustworthy at more than one worker.)
  await expect(page.getByRole("region", { name: "Grocery list" })).toHaveAttribute(
    "aria-busy",
    "false",
  );

  // Reload: the checked state is server-persisted (Convex), not just local.
  await page.reload();
  const itemAfterReload = groceryLine(page, "garlic");
  await expect(itemAfterReload.getByRole("checkbox")).toBeChecked();

  expect(pageErrors, `Uncaught page errors during the loop:\n${pageErrors.join("\n")}`).toEqual([]);
});

// BL-0021 increment 1: checking a grocery item off should auto-add it to the
// pantry (inflow), so the "don't rebuy" loop has something to diff against next
// time a list is generated. This test is self-contained — Playwright tests do
// not share login/session state, so it does its own sign-up, recipe, plan, and
// list generation rather than assuming a prior test already did so.
test("checking an item off fills the pantry", async ({ page }) => {
  const recipeTitle = `E2E Pantry Garlic ${uniqueSuffix()}`;

  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));

  await signUp(page);
  await createRecipeAndAddToBasket(page, recipeTitle, {
    quantity: "3",
    unit: "cloves",
    item: "garlic",
  });
  await scheduleAndGenerate(page, [{ title: recipeTitle, day: "Monday" }]);

  // Nav link, not page.goto(). The comment that used to sit here claimed
  // nothing was in flight, but `scheduleAndGenerate` fires the generate action
  // on its last line, so a full load can cancel it and leave the list empty.
  await navigateTo(page, "List");
  // Scoped to the grocery card. Once a line is checked off, <LeftoverProposals>
  // renders its own listitems naming the same ingredient, so an unscoped filter
  // matches two elements and hard-fails on a strict-mode violation.
  const item = groceryLine(page, "garlic");
  await expect(item).toBeVisible();
  const checkbox = item.getByRole("checkbox");
  await expect(checkbox).not.toBeChecked();
  await checkbox.check();
  await expect(checkbox).toBeChecked();

  // Nav link, not page.goto() — goto tears down the Convex socket and cancels
  // the check-off mutation just fired above, which is the write this test is
  // actually verifying (the pantry upsert happens as a side effect of it).
  await navigateTo(page, "Pantry");
  // An INVENTORY row, not any text mentioning garlic: since BL-0050 /pantry
  // also renders the use-it-up suggestions card, whose recipe rows can mention
  // garlic too (a seeded catalog has several). `pantryRow` matches on the row's
  // own id, so it says what it means rather than inferring inventory-ness from
  // the buttons the row happens to contain.
  const row = pantryRow(page, /garlic/i);
  await expect(row).toBeVisible();
  await expect(row.getByRole("button", { name: /is: have/i })).toBeVisible();

  expect(pageErrors, `Uncaught page errors during the loop:\n${pageErrors.join("\n")}`).toEqual([]);
});
