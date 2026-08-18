import { DAY_FULL, weekdayOf } from "@pantry/core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

// `jest.mock` is hoisted above this file's imports, so the factory may only
// close over names prefixed `mock`.
const mockState = { basket: [] as unknown[] };
const mockAction = jest.fn(async () => ({ count: 3 }));
const mockPrep = jest.fn(async () => ({ meals: [] }));
const mockPlanNutrition = jest.fn(async () => ({ days: [], week: null }) as unknown);
const mockMutations: Record<string, jest.Mock> = {};

// Dispatched by function name: the screen's own action and the prep derivation
// both go through `useAction`, and a `mockRejectedValueOnce` meant for one
// would otherwise be consumed by the other on mount.
jest.mock("convex/react", () => {
  const { getFunctionName } = require("convex/server");
  return {
    useQuery: (ref: unknown) =>
      getFunctionName(ref).startsWith("basket:") ? mockState.basket : [],
    useAction: (ref: unknown) => {
      const name = getFunctionName(ref);
      if (name.endsWith("generateGroceryList")) return mockAction;
      if (name === "nutrition:planNutrition") return mockPlanNutrition;
      return mockPrep;
    },
    useMutation: (ref: unknown) => {
      const name = getFunctionName(ref).split(":").pop() as string;
      mockMutations[name] ??= jest.fn(async () => undefined);
      const fn = (...args: unknown[]) => mockMutations[name](...args);
      fn.withOptimisticUpdate = () => fn;
      return fn;
    },
  };
});

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }),
}));

// Not colocated with the route on purpose — see appRouteTree.test.ts.
import PlanRoute from "../../app/(tabs)/plan";

const row = (over: Record<string, unknown>) => ({
  _id: "b1",
  _creationTime: 0,
  userId: "u1",
  recipeId: "r1",
  title: "Roast Chicken",
  ...over,
});

/** The day the planner opens on, so assertions do not depend on when they run. */
const today = weekdayOf(new Date());
const TOMORROW_LABEL = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][(today + 1) % 7];

beforeEach(() => {
  jest.clearAllMocks();
  for (const key of Object.keys(mockMutations)) delete mockMutations[key];
  mockPrep.mockResolvedValue({ meals: [] });
  mockPlanNutrition.mockResolvedValue({ days: [], week: null });
  mockState.basket = [];
});

describe("the plan route", () => {
  it("is a real screen now, not the placeholder", async () => {
    await render(<PlanRoute />);

    expect(screen.getByTestId("plan.screen")).toBeOnTheScreen();
    expect(screen.getByTestId("plan.title")).toHaveTextContent("Plan your week");
    expect(screen.queryByTestId("plan.placeholder")).toBeNull();
  });

  it("opens on today, which is the day a planner is opened to answer for", async () => {
    await render(<PlanRoute />);

    expect(screen.getByTestId("plan.day-title")).toHaveTextContent(DAY_FULL[today]);
  });

  it("shows one day at a time rather than a seven-column grid", async () => {
    mockState.basket = [
      row({ weekday: today, title: "Roast Chicken" }),
      row({ _id: "b2", recipeId: "r2", weekday: (today + 1) % 7, title: "Green Curry" }),
    ];
    await render(<PlanRoute />);

    expect(screen.getByTestId("plan.meal.roast-chicken")).toBeOnTheScreen();
    expect(screen.queryByTestId("plan.meal.green-curry")).toBeNull();

    await fireEvent.press(screen.getByTestId(`plan.day.${TOMORROW_LABEL.toLowerCase()}`));

    expect(screen.getByTestId("plan.meal.green-curry")).toBeOnTheScreen();
    expect(screen.queryByTestId("plan.meal.roast-chicken")).toBeNull();
  });

  it("says a day is empty rather than showing a bare heading", async () => {
    await render(<PlanRoute />);
    expect(screen.getByTestId("plan.day-empty")).toBeOnTheScreen();
  });

  it("plans a waiting recipe onto the day being shown, in one tap", async () => {
    mockState.basket = [row({ title: "Green Curry" })];
    await render(<PlanRoute />);

    await fireEvent.press(screen.getByTestId("plan.rail-schedule.green-curry"));

    expect(mockMutations.schedule).toHaveBeenCalledWith({ recipeId: "r1", weekday: today });
  });

  it("moves a meal to another day through an explicit action, not a drag", async () => {
    mockState.basket = [row({ weekday: today })];
    await render(<PlanRoute />);

    await fireEvent.press(screen.getByTestId("plan.move.roast-chicken"));
    expect(screen.getByTestId("plan.move-sheet")).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId(`plan.move-to.${TOMORROW_LABEL.toLowerCase()}`));

    expect(mockMutations.schedule).toHaveBeenCalledWith({
      recipeId: "r1",
      weekday: (today + 1) % 7,
    });
    // The pager follows the meal, or the move looks like a deletion.
    expect(screen.getByTestId("plan.day-title")).toHaveTextContent(DAY_FULL[(today + 1) % 7]);
  });

  it("takes a meal off the plan from the same sheet", async () => {
    mockState.basket = [row({ weekday: today })];
    await render(<PlanRoute />);
    await fireEvent.press(screen.getByTestId("plan.move.roast-chicken"));

    await fireEvent.press(screen.getByTestId("plan.move-unschedule"));

    expect(mockMutations.unschedule).toHaveBeenCalledWith({ recipeId: "r1" });
    expect(screen.queryByTestId("plan.move-sheet")).toBeNull();
  });

  it("does not offer the day the meal is already on as somewhere to move it", async () => {
    mockState.basket = [row({ weekday: today })];
    await render(<PlanRoute />);
    await fireEvent.press(screen.getByTestId("plan.move.roast-chicken"));

    const label = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"][today];
    expect(screen.getByTestId(`plan.move-to.${label}`).props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: true }),
    );
  });

  it("steps servings from the card", async () => {
    mockState.basket = [row({ weekday: today, servingsMultiplier: 2 })];
    await render(<PlanRoute />);

    await fireEvent.press(screen.getByTestId("plan.servings-down.roast-chicken"));

    expect(mockMutations.setServings).toHaveBeenCalledWith({
      recipeId: "r1",
      servingsMultiplier: 1.5,
    });
  });

  it("will not build a list from an empty basket", async () => {
    await render(<PlanRoute />);

    expect(screen.getByTestId("plan.generate").props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: true }),
    );
  });

  it("builds the week's grocery list once something is planned", async () => {
    mockState.basket = [row({ weekday: today })];
    await render(<PlanRoute />);

    await fireEvent.press(screen.getByTestId("plan.generate"));

    await waitFor(() => expect(mockAction).toHaveBeenCalledWith({}));
  });

  it("surfaces a failed build rather than leaving the button looking dead", async () => {
    mockAction.mockRejectedValueOnce(new Error("recipe service is down"));
    mockState.basket = [row({ weekday: today })];
    await render(<PlanRoute />);

    await fireEvent.press(screen.getByTestId("plan.generate"));

    await waitFor(() =>
      expect(screen.getByTestId("plan.error")).toHaveTextContent("recipe service is down"),
    );
  });

  it("badges a planned meal's lead-time prep, so a thaw is seen at planning time", async () => {
    mockState.basket = [row({ weekday: today })];
    mockPrep.mockResolvedValue({
      meals: [
        {
          recipeId: "r1",
          title: "Roast Chicken",
          cookDate: "2026-08-20",
          tasks: [
            { key: "thaw", text: "Take the chicken out", window: "night_before", missed: false },
          ],
        },
      ],
    } as never);
    await render(<PlanRoute />);

    await waitFor(() =>
      expect(screen.getByTestId("plan.prep.roast-chicken")).toHaveTextContent(/the night before/),
    );
  });

  it("carries the suggestion card, so an empty week has a way out of itself", async () => {
    await render(<PlanRoute />);
    expect(screen.getByTestId("plan.suggest")).toBeOnTheScreen();
  });
});
