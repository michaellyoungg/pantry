import { expect, test } from "@playwright/test";
import {
  createRecipeAndAddToBasket,
  navigateTo,
  planRailRow,
  signUp,
  uniqueSuffix,
} from "./helpers";

// Derived prep (BL-0042) only exists as a whole across three services: the rule
// engine and the cook-date arithmetic are in Go, the check-off is Convex state,
// and the weekday→date resolution happens in the browser against the user's
// local clock. Every one of those is covered by a unit test in isolation; this
// is the pass that proves they line up.
//
// The meal is scheduled onto MONDAY on purpose. This week's Monday is today or
// already past, so a night-before thaw is always due-or-overdue and therefore
// always on Home — scheduling onto "tomorrow" would silently pass on six days
// of the week and fail on the seventh.
test("a frozen protein produces a thaw task that survives check-off", async ({ page }) => {
  await signUp(page);

  const title = `Thaw Test ${uniqueSuffix()}`;
  await createRecipeAndAddToBasket(page, title, {
    quantity: "2",
    unit: "lb",
    item: "frozen chicken breast",
  });

  await navigateTo(page, "Plan");
  const row = planRailRow(page, title);
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Monday" }).click();
  // Wait for the scheduling write to land before navigating away — leaving with
  // it in flight cancels it.
  await expect(page.getByRole("button", { name: `Remove ${title} from Monday` })).toBeVisible();

  // The planner badge: the lead time is visible where the meal is scheduled,
  // which is the whole point of deriving against the cook date.
  const planned = page.getByRole("listitem").filter({ hasText: title });
  await expect(planned.getByText(/prep:/)).toBeVisible();

  // --- Home surfaces it, named against its meal ---
  await navigateTo(page, "Home");
  const card = page.getByRole("region", { name: "Before you cook" });
  await expect(card).toBeVisible();
  // "frozen chicken breast" canonicalizes to "chicken breast", which is the
  // subject the rule interpolates. That mapping is the reason a single rule
  // covers every recipe in the database.
  await expect(card.getByText("Move the chicken breast to the fridge to thaw")).toBeVisible();

  const box = card.getByRole("checkbox", {
    name: `Move the chicken breast to the fridge to thaw for ${title}`,
  });
  await expect(box).not.toBeChecked();
  await box.check();
  // The tick is not optimistic: it round-trips through Convex and comes back
  // over the socket, so a checked box means the mutation actually landed.
  await expect(box).toBeChecked();

  // --- and the tick survives a full reload, keyed on the stable task key ---
  await page.reload();
  const afterReload = page.getByRole("region", { name: "Before you cook" }).getByRole("checkbox", {
    name: `Move the chicken breast to the fridge to thaw for ${title}`,
  });
  await expect(afterReload).toBeChecked();
});
