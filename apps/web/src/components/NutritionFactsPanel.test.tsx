import { NUTRITION_FACTS_FOOTNOTES, nutritionFactsLabel } from "@pantry/core";
import type { NutrientAmount, NutritionTarget } from "@pantry/types";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NutritionFactsPanel } from "./NutritionFactsPanel";

const UNITS: Record<string, string> = {
  "1008": "kcal",
  "1003": "g",
  "1004": "g",
  "1005": "g",
  "1079": "g",
  "1258": "g",
  "2000": "g",
  "1253": "mg",
  "1093": "mg",
  "1087": "mg",
  "1089": "mg",
  "1092": "mg",
};

function vector(amounts: Record<string, number>): Record<string, NutrientAmount> {
  return Object.fromEntries(
    Object.entries(amounts).map(([id, amount]) => [
      id,
      { nutrientId: id, amount, unit: UNITS[id] ?? "g" },
    ]),
  );
}

/** What the estimator's snapshot seed actually carries for a plausible dish. */
const DISH = vector({
  "1008": 520,
  "1003": 28.4,
  "1004": 19.5,
  "1258": 6,
  "1005": 55,
  "1079": 7,
  "2000": 8.2,
  "1253": 90,
  "1093": 890,
  "1092": 470,
  "1087": 130,
  "1089": 4.5,
});

function panel(props: Partial<React.ComponentProps<typeof NutritionFactsPanel>> = {}) {
  return render(
    <NutritionFactsPanel
      rows={nutritionFactsLabel(DISH)}
      servingsLabel="4 servings per recipe"
      {...props}
    />,
  );
}

/** The `<tr>` a nutrient's row header sits in. */
function rowFor(label: string): HTMLElement {
  const header = screen.getByRole("rowheader", { name: label });
  const tr = header.closest("tr");
  if (!tr) throw new Error(`row header ${label} is not in a row`);
  return tr;
}

describe("NutritionFactsPanel — the label's shape", () => {
  it("renders a real table with scoped headers, not a div grid", () => {
    panel();
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getByRole("rowheader", { name: "Sodium" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "% Daily Value" })).toBeTruthy();
  });

  // These are the exact roles and names `e2e/nutrition-facts.spec.ts` locates
  // the panel by. Pinning them here means a rename breaks a fast unit test
  // rather than only the browser suite, which is not part of the per-PR gate.
  it("exposes the landmark and row names the e2e spec locates it by", () => {
    panel();
    expect(screen.getByRole("region", { name: "Nutrition Facts" })).toBeTruthy();
    expect(screen.getByRole("rowheader", { name: "Total carbohydrate" })).toBeTruthy();
    expect(screen.getByRole("rowheader", { name: "Trans fat" })).toBeTruthy();
  });

  it("keeps every mandatory row even when the estimate carries none of them", () => {
    panel({ rows: nutritionFactsLabel(undefined) });
    for (const label of ["Calories", "Total fat", "Trans fat", "Protein", "Vitamin D"]) {
      expect(screen.getByRole("rowheader", { name: label })).toBeTruthy();
    }
  });

  it("states the serving count and never invents a serving size", () => {
    panel();
    expect(screen.getByText("4 servings per recipe")).toBeTruthy();
    // A real panel names the serving ("1 cup"). We know a count, not a
    // household measure, so there is no serving-size line at all.
    expect(screen.queryByText(/Serving size/i)).toBeNull();
  });

  it("uses the whole-recipe header when the recipe carries no yield", () => {
    panel({ servingsLabel: "Entire recipe" });
    expect(screen.getByText("Entire recipe")).toBeTruthy();
  });
});

describe("NutritionFactsPanel — amounts and percentages", () => {
  it("prints the amount and its share of the daily reference", () => {
    panel();
    const sodium = rowFor("Sodium");
    expect(within(sodium).getByText("890 mg")).toBeTruthy();
    expect(within(sodium).getByText("39%")).toBeTruthy();
  });

  it("divides by the serving count when the caller does", () => {
    panel({ rows: nutritionFactsLabel(DISH, { divisor: 4 }) });
    const sodium = rowFor("Sodium");
    expect(within(sodium).getByText("223 mg")).toBeTruthy();
    expect(within(sodium).getByText("10%")).toBeTruthy();
  });

  it("leaves the %DV cell blank for nutrients that carry no Daily Value", () => {
    panel();
    // Protein is measured; it simply has no Daily Value, exactly as on the
    // printed label. A dash here would collide with the footnote's meaning.
    const protein = rowFor("Protein");
    expect(within(protein).getByText("28.4 g")).toBeTruthy();
    expect(within(protein).queryByText("—")).toBeNull();
  });
});

describe("NutritionFactsPanel — coverage honesty", () => {
  it("prints an em-dash, never a zero, for a nutrient it could not estimate", () => {
    panel();
    // Trans fat, added sugars and vitamin D are mandatory lines the estimator's
    // seed does not carry. A confident 0 g on a panel that looks official is
    // the most misleading thing this surface could do.
    for (const label of ["Trans fat", "Added sugars", "Vitamin D"]) {
      const row = rowFor(label);
      expect(within(row).getAllByText("—").length).toBeGreaterThan(0);
      expect(within(row).queryByText(/^0/)).toBeNull();
    }
  });

  it("says what the em-dash means, and that the panel is an estimate", () => {
    panel();
    expect(screen.getByText(NUTRITION_FACTS_FOOTNOTES[1])).toBeTruthy();
    expect(screen.getByText(NUTRITION_FACTS_FOOTNOTES[2])).toBeTruthy();
  });

  it("carries the standard 2,000-calorie sentence that makes %DV mean anything", () => {
    panel();
    expect(screen.getByText(NUTRITION_FACTS_FOOTNOTES[0])).toBeTruthy();
  });

  it("names how much of the food it accounted for when that is not all of it", () => {
    panel({ coveragePercent: 86 });
    expect(screen.getByText("86% of ingredients accounted for")).toBeTruthy();
  });

  it("stays quiet about coverage when everything resolved", () => {
    panel({ coveragePercent: 100 });
    expect(screen.queryByText(/accounted for/)).toBeNull();
  });
});

describe("NutritionFactsPanel — the personal column", () => {
  const proteinGoal: NutritionTarget = {
    nutrientId: "1003",
    operator: ">=",
    value: 150,
    period: "day",
    active: true,
  };

  it("collapses to two columns when the user has no goals", () => {
    panel();
    expect(screen.queryByRole("columnheader", { name: "% of your goal" })).toBeNull();
  });

  it("adds the personal column beside the standard one when a goal exists", () => {
    panel({
      rows: nutritionFactsLabel(DISH, { targets: [proteinGoal], period: "day" }),
    });
    expect(screen.getByRole("columnheader", { name: "% of your goal" })).toBeTruthy();
    // Both figures, side by side: the %DV stays the number every user sees for
    // this food, and the personal one is added rather than substituted.
    const protein = within(rowFor("Protein"));
    expect(protein.getByText("19%")).toBeTruthy();
    const sodium = within(rowFor("Sodium"));
    expect(sodium.getByText("39%")).toBeTruthy();
  });

  it("shows an em-dash for a goal on a nutrient it could not estimate", () => {
    const goal: NutritionTarget = { ...proteinGoal, nutrientId: "1114", value: 15 };
    panel({ rows: nutritionFactsLabel(DISH, { targets: [goal], period: "day" }) });
    // The user set a vitamin D goal; we cannot answer it. Dropping the column
    // would make the goal disappear exactly when we stopped being able to
    // report on it.
    expect(screen.getByRole("columnheader", { name: "% of your goal" })).toBeTruthy();
    expect(within(rowFor("Vitamin D")).getAllByText("—").length).toBe(3);
  });

  it("lets a caller force the classic two-column layout", () => {
    panel({
      rows: nutritionFactsLabel(DISH, { targets: [proteinGoal], period: "day" }),
      showTargets: false,
    });
    expect(screen.queryByRole("columnheader", { name: "% of your goal" })).toBeNull();
  });
});
