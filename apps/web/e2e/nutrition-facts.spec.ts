import { expect, test } from "@playwright/test";
import { signUp, uniqueSuffix } from "./helpers";

// BL-0049: the Nutrition Facts panel, end to end against a live stack.
//
// The unit tests already cover the arithmetic and the layout. What only a real
// browser can prove is that the panel survives the whole chain — the recipe
// reaches recipe-service, the estimator resolves an ingredient against its
// snapshot seed, coverage clears the threshold, and the *exact* honesty copy
// reaches the screen.
//
// That copy is pinned verbatim on purpose. The footnote is the only thing
// standing between an estimate and a panel that looks like a regulated label,
// so a well-meaning reword should fail a test rather than ship quietly.

const FOOTNOTES = {
  dailyValue:
    "The % Daily Value tells you how much a nutrient in a serving contributes to a daily diet. 2,000 calories a day is used for general nutrition advice.",
  emDash: "— means we could not estimate that nutrient. It is not zero.",
  notALabel:
    "Estimated from your ingredient list using USDA food data. This is not a regulated Nutrition Facts label.",
};

test("a recipe shows its estimate as a Nutrition Facts panel", async ({ page }) => {
  const recipeTitle = `E2E Nutrition Flour ${uniqueSuffix()}`;

  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));

  await signUp(page);

  // Created inline rather than through `createRecipeAndAddToBasket`, which fills
  // the *Servings* spinbutton with its `quantity` and leaves the ingredient at
  // 1. This test needs the opposite: a real ingredient weight, and Servings left
  // blank so the panel has no yield to divide by and must say "Entire recipe".
  await page.goto("/recipes");
  await page.getByPlaceholder("Title").fill(recipeTitle);
  // Grams of flour: a mass unit needs no household-measure lookup and flour is
  // in the estimator's offline snapshot, so this recipe resolves fully and the
  // panel is not suppressed by the coverage rule.
  await page.getByLabel("quantity").first().fill("200");
  await page.getByPlaceholder("unit").first().fill("g");
  await page.getByPlaceholder("item").first().fill("flour");
  await page.getByRole("button", { name: "Create recipe" }).click();

  const row = page.getByRole("listitem").filter({ hasText: recipeTitle });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Nutrition" }).click();

  const panel = page.getByRole("region", { name: "Nutrition Facts" });
  await expect(panel).toBeVisible();

  // The recipe carries no yield, so the panel names the whole recipe rather
  // than inventing a serving.
  // `exact` matters: the table's sr-only <caption> repeats this label inside a
  // longer sentence, and a substring match would resolve to two elements.
  await expect(panel.getByText("Entire recipe", { exact: true })).toBeVisible();
  await expect(panel.getByRole("columnheader", { name: "% Daily Value" })).toBeVisible();

  // A real table: the row-and-column relationship the visual rules draw is
  // information, and assistive technology gets it too.
  await expect(panel.getByRole("rowheader", { name: "Calories" })).toBeVisible();
  await expect(panel.getByRole("rowheader", { name: "Total carbohydrate" })).toBeVisible();

  // Coverage honesty, on the surface where a confident zero would be most
  // misleading: the estimator's seed carries no trans fat figure, so the row
  // prints an em-dash and never a 0.
  const transFat = panel.getByRole("row").filter({ hasText: "Trans fat" });
  await expect(transFat).toContainText("—");
  await expect(transFat).not.toContainText("0 g");

  // The three footnote lines, verbatim.
  await expect(panel.getByText(FOOTNOTES.dailyValue)).toBeVisible();
  await expect(panel.getByText(FOOTNOTES.emDash)).toBeVisible();
  await expect(panel.getByText(FOOTNOTES.notALabel)).toBeVisible();

  // With no goals set, the panel stays in its classic two-column form.
  await expect(panel.getByRole("columnheader", { name: "% of your goal" })).toHaveCount(0);

  expect(pageErrors, `Uncaught page errors:\n${pageErrors.join("\n")}`).toEqual([]);
});
