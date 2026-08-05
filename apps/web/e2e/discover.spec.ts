import { expect, type Page, test } from "@playwright/test";
import { navigateTo, signUp, uniqueSuffix } from "./helpers";

/**
 * The "For you" card on /recipes — the discovery surface (BL-0005 increment 2).
 *
 * Scoped to the region because /recipes also renders the user's own recipe list,
 * whose rows mention the same titles.
 */
function forYou(page: Page) {
  return page.getByRole("region", { name: "For you" });
}

/**
 * A recipe from the seeded catalog. The catalog exists in the e2e environment
 * only because scripts/e2e.sh runs cmd/seed (BL-0051); without it this whole
 * surface would be empty for a brand-new user and every assertion here would be
 * vacuous.
 */
const SEEDED = "Spaghetti Aglio e Olio";

test("suggests catalog recipes to a brand-new user", async ({ page }) => {
  await signUp(page);
  await navigateTo(page, "Recipes");

  // The COLD-START path, end to end. This user has no events, no preferences
  // and an empty pantry, so every scoring feature the ranker owns is either
  // unavailable or equal across candidates. It must still produce a ranked list
  // rather than an empty one — "we know nothing about you" is not a reason to
  // show nothing.
  await expect(forYou(page).getByText(SEEDED)).toBeVisible({ timeout: 15_000 });
});

test("a dismissed suggestion does not come back", async ({ page }) => {
  await signUp(page);
  await navigateTo(page, "Recipes");

  const row = forYou(page).getByRole("listitem").filter({ hasText: SEEDED });
  await expect(row).toBeVisible({ timeout: 15_000 });

  await row.getByRole("button", { name: `Not for me: ${SEEDED}` }).click();
  await expect(row).toHaveCount(0);

  // The real assertion, and the reason this test exists: leave the page and come
  // back. The card refetches from scratch, so the recipe can only stay hidden if
  // the dismissal was written to `recommendationEvents` and read back by the
  // ranker. Local state alone would let it reappear.
  //
  // Waiting for the card to have rendered SOMETHING first is what makes the
  // absence meaningful — a remounted card is empty for a moment, and asserting
  // `toHaveCount(0)` against that would pass before the request even returned.
  await navigateTo(page, "Plan");
  await navigateTo(page, "Recipes");
  await expect(forYou(page).getByRole("listitem").first()).toBeVisible({ timeout: 15_000 });
  await expect(forYou(page).getByRole("listitem").filter({ hasText: SEEDED })).toHaveCount(0);
});

test("adding a suggestion puts it on the plan", async ({ page }) => {
  await signUp(page);
  await navigateTo(page, "Recipes");

  const row = forYou(page).getByRole("listitem").filter({ hasText: SEEDED });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.getByRole("button", { name: `Add ${SEEDED} to plan` }).click();

  await navigateTo(page, "Plan");
  await expect(page.getByRole("listitem").filter({ hasText: SEEDED })).toBeVisible();

  // And it stops being offered, because a recipe already on the week's plan is
  // not a discovery.
  await navigateTo(page, "Recipes");
  await expect(forYou(page).getByRole("listitem").first()).toBeVisible({ timeout: 15_000 });
  await expect(forYou(page).getByRole("listitem").filter({ hasText: SEEDED })).toHaveCount(0);
});

test("never suggests a recipe containing an avoided ingredient", async ({ page }) => {
  await signUp(page);

  // A recipe of the user's own, built on an allergen, so the test does not
  // depend on what happens to be in the catalog. It is never planned, so it
  // stays an eligible candidate.
  //
  // Its ingredient text is deliberately NOT the word the avoid entry uses: it
  // says "creamy peanut butter" and the entry says "peanut". Nothing matches on
  // that pair unless the entry canonicalizes to the peanut allergen family and
  // the recipe text canonicalizes to a member of it (BL-0052).
  const title = `Peanut Noodles ${uniqueSuffix()}`;
  await navigateTo(page, "Recipes");
  await page.getByPlaceholder("Title").fill(title);
  await page.getByRole("spinbutton").first().fill("2");
  await page.getByPlaceholder("unit").first().fill("tbsp");
  await page.getByPlaceholder("item").first().fill("creamy peanut butter");
  await page.getByRole("button", { name: "Create recipe" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: title })).toBeVisible();

  // BASELINE: it surfaces before the avoid entry exists. Asserting only the
  // absence would pass even with the filter entirely broken.
  await navigateTo(page, "Plan");
  await navigateTo(page, "Recipes");
  await expect(forYou(page).getByText(title)).toBeVisible({ timeout: 15_000 });

  // Scoped to the Preferences card: /settings also hosts the nutrition goals,
  // whose "Add a goal" card has its own "Add" button.
  await navigateTo(page, "Settings");
  const prefs = page.locator("section").filter({ hasText: "Preferences" });
  await prefs.getByPlaceholder("Ingredient to avoid").fill("peanut");
  await prefs.getByRole("button", { name: "Add" }).click();
  await expect(
    prefs
      .getByRole("list", { name: "Ingredients you avoid" })
      .getByRole("listitem")
      .filter({ hasText: "Peanuts" }),
  ).toBeVisible();

  // A recommendation surface that can put an allergen on screen is a safety bug,
  // not a ranking bug — and the discover surface has to enforce it in its own
  // right, not because the pantry surface happens to.
  await navigateTo(page, "Recipes");
  await expect(forYou(page).getByRole("listitem").first()).toBeVisible({ timeout: 15_000 });
  await expect(forYou(page).getByText(title)).toHaveCount(0);
});
