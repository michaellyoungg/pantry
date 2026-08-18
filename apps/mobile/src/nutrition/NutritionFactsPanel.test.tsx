import { nutritionFactsLabel, NUTRITION_FACTS_FOOTNOTES } from "@pantry/core";
import type { NutrientAmount, NutritionTarget } from "@pantry/types";
import { render, screen } from "@testing-library/react-native";
import { NutritionFactsPanel } from "./NutritionFactsPanel";

/**
 * The label, native.
 *
 * The arithmetic is `nutritionFactsLabel`'s and is tested in `@pantry/core`
 * without a renderer. What is asserted here is the part only a renderer can
 * show: that the shape is a Nutrition Facts panel, and that the two ways a
 * figure can be absent still look different.
 */

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

const proteinGoal: NutritionTarget = {
  nutrientId: "1003",
  operator: ">=",
  value: 40,
  period: "meal",
  active: true,
};

async function panel(props: Partial<React.ComponentProps<typeof NutritionFactsPanel>> = {}) {
  return await render(
    <NutritionFactsPanel
      rows={nutritionFactsLabel(DISH)}
      servingsLabel="4 servings per recipe"
      surface="recipes"
      {...props}
    />,
  );
}

describe("the panel's shape", () => {
  it("is a Nutrition Facts panel, and says what one column covers", async () => {
    await panel();

    expect(screen.getByTestId("recipes.nutrition-facts")).toBeOnTheScreen();
    expect(screen.getByText("Nutrition Facts")).toBeOnTheScreen();
    expect(screen.getByTestId("recipes.nutrition-servings")).toHaveTextContent(
      "4 servings per recipe",
    );
  });

  // A recipe missing four nutrients must yield a panel of the same shape as one
  // missing none — a layout that reflows recipe to recipe stops reading as a
  // label.
  it("prints every row in the FDA's order, whatever the estimate carries", async () => {
    await panel({ rows: nutritionFactsLabel(vector({ "1008": 100 })) });

    for (const label of ["Calories", "Total fat", "Saturated fat", "Cholesterol", "Potassium"]) {
      expect(screen.getByText(label)).toBeOnTheScreen();
    }
  });

  it("leads with calories and the % Daily Value heading", async () => {
    await panel();

    expect(screen.getByText("520 kcal")).toBeOnTheScreen();
    expect(screen.getByText("% Daily Value")).toBeOnTheScreen();
  });

  it("carries the footnote that makes the panel honest about what it is", async () => {
    await panel();

    for (const line of NUTRITION_FACTS_FOOTNOTES) {
      expect(screen.getByText(line)).toBeOnTheScreen();
    }
  });

  it("says how much of the food it accounted for, when it is not all of it", async () => {
    await panel({ coveragePercent: 84 });

    expect(screen.getByTestId("recipes.nutrition-coverage")).toHaveTextContent(
      "84% of ingredients accounted for",
    );
  });

  it("says nothing about coverage when everything was accounted for", async () => {
    await panel({ coveragePercent: 100 });

    expect(screen.queryByTestId("recipes.nutrition-coverage")).toBeNull();
  });
});

describe("coverage honesty", () => {
  // React Native has no table, so the row-and-column relationship the web
  // panel gets from `<th scope>` is carried by each row's accessible label.
  it("announces a nutrient with its amount and its share of a day", async () => {
    await panel();

    expect(screen.getByLabelText("Sodium, 890 mg, 39% of the Daily Value")).toBeOnTheScreen();
  });

  // The most damaging lie available to a quasi-official panel is a zero we did
  // not measure.
  it("prints an unmeasured nutrient as the em-dash, never as zero", async () => {
    await panel();

    expect(screen.getByLabelText(/^Vitamin D, not estimated/)).toBeOnTheScreen();
    expect(screen.queryByLabelText(/Vitamin D, 0/)).toBeNull();
  });

  // Two different absences: protein has no Daily Value and never will, so its
  // cell is blank; vitamin D has one we could not fill, so it is a dash the
  // footnote defines.
  it("keeps 'no Daily Value exists' apart from 'we could not measure it'", async () => {
    await panel();

    expect(screen.getByLabelText("Protein, 28.4 g")).toBeOnTheScreen();
    expect(
      screen.getByLabelText("Vitamin D, not estimated, Daily Value not estimated"),
    ).toBeOnTheScreen();
  });
});

describe("the personal column", () => {
  it("stays away until the user has a goal on one of these nutrients", async () => {
    await panel();

    expect(screen.queryByText("% of your goal")).toBeNull();
  });

  it("appears, and reads the goal's share, once one is set", async () => {
    await panel({
      rows: nutritionFactsLabel(DISH, { targets: [proteinGoal], period: "meal" }),
    });

    expect(screen.getByText("% of your goal")).toBeOnTheScreen();
    expect(screen.getByLabelText("Protein, 28.4 g, 71% of your goal")).toBeOnTheScreen();
  });

  // A user who set a goal is owed "we can't tell you" rather than the goal's
  // silent disappearance at the moment we stopped being able to answer it.
  it("keeps a goal we could not score, as a dash", async () => {
    await panel({
      rows: nutritionFactsLabel(vector({ "1008": 100 }), {
        targets: [proteinGoal],
        period: "meal",
      }),
    });

    expect(
      screen.getByLabelText("Protein, not estimated, your goal not estimated"),
    ).toBeOnTheScreen();
  });
});
