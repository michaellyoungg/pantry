import { expect, type Locator, type Page, test } from "@playwright/test";
import { navigateTo, signUp } from "./helpers";

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
 * Nothing here names a recipe. The catalog is shared, seeded data that other
 * work grows (BL-0002 took it from 6 recipes to 57) while this card shows only
 * the top handful, so any specific title is a bet on the ranking — and a spec
 * that pins one fails for a reason that has nothing to do with discovery. Every
 * test below asks the surface what it is offering and then asserts on THAT.
 *
 * What they do depend on is the card being non-empty for a brand-new user, which
 * holds because scripts/e2e.sh seeds the catalog (BL-0051).
 */

/**
 * Wait until the card has actually rendered a response — a suggestion, or the
 * empty state.
 *
 * This is what makes a later `toHaveCount(0)` mean something. A remounted card
 * is empty for as long as the request is in flight, so asserting absence against
 * it would pass before the ranker had said anything at all.
 */
async function settled(page: Page): Promise<void> {
  const card = forYou(page);
  await expect(
    card
      .getByRole("listitem")
      .first()
      .or(card.getByText(/Nothing new to suggest/)),
  ).toBeVisible({ timeout: 15_000 });
}

/** The top suggestion, and the title it is being offered under. */
async function topSuggestion(page: Page): Promise<{ row: Locator; title: string }> {
  const row = forYou(page).getByRole("listitem").first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  const title = ((await row.getByRole("link").textContent()) ?? "").trim();
  expect(title).not.toBe("");
  return { row, title };
}

test("suggests something to a brand-new user", async ({ page }) => {
  await signUp(page);
  await navigateTo(page, "Recipes");

  // The COLD-START path, end to end. This user has no events, no preferences
  // and an empty pantry, so every scoring feature the ranker owns is either
  // unavailable or equal across candidates. It must still produce a ranked list
  // rather than an empty one — "we know nothing about you" is not a reason to
  // show nothing, and scoring the unknown as zero instead of unavailable is
  // exactly how a recommender ends up showing new users nothing.
  const { title } = await topSuggestion(page);
  expect(title.length).toBeGreaterThan(0);
});

test("a dismissed suggestion does not come back", async ({ page }) => {
  await signUp(page);
  await navigateTo(page, "Recipes");

  const { title } = await topSuggestion(page);
  await forYou(page)
    .getByRole("button", { name: `Not for me: ${title}` })
    .click();
  await expect(forYou(page).getByRole("listitem").filter({ hasText: title })).toHaveCount(0);

  // The real assertion, and the reason this test exists: leave the page and come
  // back. The card refetches from scratch, so the recipe can only stay hidden if
  // the dismissal was written to `recommendationEvents` and read back by the
  // ranker. Local state alone would let it reappear.
  await navigateTo(page, "Plan");
  await navigateTo(page, "Recipes");
  await settled(page);
  await expect(forYou(page).getByRole("listitem").filter({ hasText: title })).toHaveCount(0);
});

test("adding a suggestion puts it on the plan", async ({ page }) => {
  await signUp(page);
  await navigateTo(page, "Recipes");

  const { title } = await topSuggestion(page);
  await forYou(page)
    .getByRole("button", { name: `Add ${title} to plan` })
    .click();

  await navigateTo(page, "Plan");
  await expect(page.getByRole("listitem").filter({ hasText: title })).toBeVisible();

  // And it stops being offered, because a recipe already on the week's plan is
  // not a discovery.
  await navigateTo(page, "Recipes");
  await settled(page);
  await expect(forYou(page).getByRole("listitem").filter({ hasText: title })).toHaveCount(0);
});

test("never suggests a recipe containing an avoided ingredient", async ({ page }) => {
  await signUp(page);
  await navigateTo(page, "Recipes");

  // Take a recipe the surface is ALREADY offering, and one ingredient it says
  // you would need for it, then avoid that ingredient. Reading the pair off the
  // card is what lines the two halves up without naming anything: the baseline
  // is true by construction, so the absence at the end is the only thing under
  // test.
  //
  // "Need:" lists the ingredients the user does not have — for a brand-new user
  // with an empty pantry, all of them — and prints the DICTIONARY's display
  // name, so typing it back into the avoid box canonicalizes to the same item
  // the recipe's own ingredient text did.
  const row = forYou(page).getByRole("listitem").filter({ hasText: /Need:/ }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  const title = ((await row.getByRole("link").textContent()) ?? "").trim();
  const needed = ((await row.getByText(/^Need:/).textContent()) ?? "")
    .replace(/^Need:\s*/, "")
    .split(",")[0]
    .trim();
  expect(needed).not.toBe("");

  // Scoped to the Preferences card: /settings also hosts the nutrition goals,
  // whose "Add a goal" card has its own "Add" button.
  await navigateTo(page, "Settings");
  const prefs = page.locator("section").filter({ hasText: "Preferences" });
  await prefs.getByPlaceholder("Ingredient to avoid").fill(needed);
  await prefs.getByRole("button", { name: "Add" }).click();

  // The entry is resolved through the dictionary before it is stored, and one
  // that matches nothing says so instead of being saved (BL-0052). Both are
  // asserted, because a silently unmatched entry would leave the check below
  // passing while nothing was being filtered.
  await expect(
    prefs.getByRole("list", { name: "Ingredients you avoid" }).getByRole("listitem"),
  ).toHaveCount(1);
  await expect(prefs.getByText(/doesn’t match any ingredient we know/i)).toHaveCount(0);

  // A recommendation surface that can put an allergen on screen is a safety bug,
  // not a ranking bug — and discover has to enforce the filter in its own right,
  // not because the pantry surface happens to.
  //
  // The allergen-FAMILY half of that filter ("peanut" reaching "creamy peanut
  // butter") is covered against the real dictionary by recommendations.spec.ts
  // and against the ranker by internal/recommend/discover_test.go. What is under
  // test here is that discover applies the avoid list at all.
  await navigateTo(page, "Recipes");
  await settled(page);
  await expect(forYou(page).getByRole("listitem").filter({ hasText: title })).toHaveCount(0);
});
