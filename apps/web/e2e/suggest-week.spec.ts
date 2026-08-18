import { expect, type Page, test } from "@playwright/test";
import {
  createRecipeAndAddToBasket,
  navigateTo,
  planRailRow,
  signUp,
  uniqueSuffix,
} from "./helpers";

/**
 * "Suggest my week" (BL-0033) end to end.
 *
 * What only a browser can prove here is the anti-friction contract: pressing the
 * button changes NOTHING until the proposal is accepted, and accepting it never
 * disturbs a day the user had already planned. Both are properties of the whole
 * loop — Convex mutations, the reactive basket, and the planner grid — not of
 * any one unit.
 *
 * The recipes are the test's own. `weekCandidates` sends `includeUnmatched`, so
 * a user recipe is an eligible candidate without any pantry state at all, which
 * keeps this spec independent of the grocery/check-off loop.
 *
 * It is NOT independent of the shared catalog, and used to assume it was. Since
 * BL-0051 seeded it, `recommendPantry` ranks the caller's recipes together with
 * all 57 catalog rows, and against an empty pantry with no preferences every one
 * of them scores identically — so the ranker falls through to its documented
 * tiebreak, recipe id ascending. Catalog ids are `cat-…`; a user recipe's is a
 * random 32-char hex string, which sorts after them about one time in five — so
 * with two recipes in play, roughly one run in twenty-three proposed a catalog
 * dinner for Monday and the spec's old "a title carrying my suffix landed on
 * Monday" assertion simply lost. Which dinner gets proposed is not this spec's
 * to predict; the assertions below read the proposal instead (BL-0074).
 */

/** The suggester card, scoped by its heading so /plan's other cards can't match. */
function suggester(page: Page) {
  return page.locator("section").filter({ hasText: "Suggest my week" });
}

/** One day column of the week grid. Each is a region named for its weekday. */
function dayColumn(page: Page, fullDay: string) {
  return page.getByRole("region", { name: fullDay, exact: true });
}

test("proposes a week, writes nothing until accepted, then plans it", async ({ page }) => {
  await signUp(page);

  // Two recipes sharing an ingredient, so the set-level explanation has
  // something true to say about them.
  const suffix = uniqueSuffix();
  const first = `Chicken Rice ${suffix}`;
  const second = `Chicken Tacos ${suffix}`;
  await createRecipeAndAddToBasket(page, first, { quantity: "1", unit: "lb", item: "chicken" });
  await createRecipeAndAddToBasket(page, second, { quantity: "2", unit: "lb", item: "chicken" });

  await navigateTo(page, "Plan");
  const card = suggester(page);
  await card.getByRole("button", { name: "Suggest my week" }).click();

  // A proposal, explicitly marked as not yet saved.
  await expect(card.getByText(/nothing is saved until you add it/i)).toBeVisible();

  // Nothing has been scheduled: Monday is still empty, exactly as it was before
  // the button was pressed. This is the anti-friction contract.
  await expect(dayColumn(page, "Monday").getByText("No dinner planned")).toBeVisible();

  // What the proposal says it will put on Monday, read off the card. Taken from
  // the "Not <title>" control because that is the one place a pick's title is
  // rendered on its own rather than run together with its day and its reasons.
  const mondayPick = card.getByRole("listitem").filter({ hasText: /^\s*Monday\s*—/ });
  const notThis = await mondayPick
    .getByRole("button", { name: /^Not / })
    .getAttribute("aria-label");
  const proposedTitle = (notThis ?? "").replace(/^Not /, "");
  expect(proposedTitle, "the proposal should name a dinner for Monday").not.toBe("");

  await card.getByRole("button", { name: "Add to my week" }).click();

  // Accepted: the proposal clears and the week is filled.
  //
  // The card clearing is local state — `accept` calls `discard()` — so it is not
  // on its own evidence that anything was written. aria-busy is: it tracks the
  // `useAsyncAction` wrapping the add+schedule pair for every pick, and none of
  // those mutations is optimistic, so "no longer busy" means the backend
  // acknowledged all of them. Only then is the week grid, which renders from
  // `api.basket.list`, showing server state rather than an in-flight guess.
  await expect(card.getByRole("button", { name: "Add to my week" })).toHaveCount(0);
  await expect(card).toHaveAttribute("aria-busy", "false");

  // The contract, stated exactly: the dinner the proposal offered for Monday is
  // the dinner Monday now has. Asserting the proposal's own title rather than
  // this spec's `suffix` is what makes it a claim about the feature instead of a
  // bet on which candidate the ranker happened to put first.
  await expect(dayColumn(page, "Monday").getByText("No dinner planned")).toHaveCount(0);
  await expect(dayColumn(page, "Monday").getByText(proposedTitle, { exact: true })).toBeVisible();
});

test("regenerating leaves an already-planned day alone", async ({ page }) => {
  await signUp(page);

  const suffix = uniqueSuffix();
  const planned = `Planned Salmon ${suffix}`;
  const other = `Other Beef ${suffix}`;
  await createRecipeAndAddToBasket(page, planned, { quantity: "1", unit: "lb", item: "salmon" });
  await createRecipeAndAddToBasket(page, other, { quantity: "1", unit: "lb", item: "beef" });

  // Plan Wednesday by hand first — this is the meal that must survive.
  await navigateTo(page, "Plan");
  const railRow = planRailRow(page, planned);
  await expect(railRow).toBeVisible();
  await railRow.getByRole("button", { name: "Wednesday" }).click();
  await expect(dayColumn(page, "Wednesday").getByText(planned)).toBeVisible();

  const card = suggester(page);
  await card.getByRole("button", { name: "Suggest my week" }).click();

  // The suggester says which day it will not touch, and does not touch it.
  await expect(card.getByText(/Left alone: Wednesday/)).toBeVisible();
  await card.getByRole("button", { name: "Add to my week" }).click();

  // Wait for the accept to be acknowledged before checking Wednesday survived.
  // Without it the assertion below can be satisfied by a week nothing has been
  // written to yet, which is the one state in which it could not possibly fail.
  await expect(card).toHaveAttribute("aria-busy", "false");
  await expect(card.getByRole("button", { name: "Add to my week" })).toHaveCount(0);
  await expect(dayColumn(page, "Wednesday").getByText(planned)).toBeVisible();
});
