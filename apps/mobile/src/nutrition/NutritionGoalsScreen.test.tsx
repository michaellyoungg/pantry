import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

/**
 * The nutrition goal editor screen.
 *
 * `jest.mock` is hoisted above this file's imports, so the factory may only
 * close over names prefixed `mock`.
 */
const mockRows = { targets: [] as Array<Record<string, unknown>> | undefined };
const mockAdd = jest.fn(async () => undefined as unknown);
const mockRemove = jest.fn(async () => undefined as unknown);
const mockSetActive = jest.fn(async () => undefined as unknown);
const mockSetHard = jest.fn(async () => undefined as unknown);
const mockApplyPreset = jest.fn(async () => undefined as unknown);

jest.mock("convex/react", () => {
  const { getFunctionName } = require("convex/server");
  // Resolved per call, not once: the factory runs at the first import of
  // `convex/react`, which is before the `const mock…` bindings above are
  // initialised, so a map built here would capture five undefineds.
  const spyFor = (name: string): jest.Mock =>
    ({
      "nutritionTargets:add": mockAdd,
      "nutritionTargets:remove": mockRemove,
      "nutritionTargets:setActive": mockSetActive,
      "nutritionTargets:setHard": mockSetHard,
      "nutritionTargets:applyPreset": mockApplyPreset,
    })[name] as jest.Mock;
  return {
    useQuery: () => mockRows.targets,
    useMutation: (ref: unknown) => spyFor(getFunctionName(ref)),
  };
});

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }),
}));

// Not colocated with the route on purpose — see appRouteTree.test.ts.
import NutritionGoalsRoute from "../../app/nutrition/goals";

const row = (over: Record<string, unknown> = {}) => ({
  _id: "t1",
  _creationTime: 0,
  userId: "u1",
  nutrientId: "1003",
  operator: ">=",
  value: 150,
  period: "day",
  active: true,
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockRows.targets = [];
});

describe("the stored goals", () => {
  it("is a screen of its own, reached from Settings", async () => {
    await render(<NutritionGoalsRoute />);

    expect(screen.getByTestId("settings.goals-screen")).toBeOnTheScreen();
    expect(screen.getByTestId("settings.goals-title")).toHaveTextContent("Nutrition goals");
  });

  it("groups goals under the window they apply to", async () => {
    mockRows.targets = [row(), row({ _id: "t2", nutrientId: "1093", period: "meal" })];

    await render(<NutritionGoalsRoute />);

    expect(screen.getByText("Per day")).toBeOnTheScreen();
    expect(screen.getByText("Per meal")).toBeOnTheScreen();
    expect(screen.getByTestId("settings.goal.1003-day")).toHaveTextContent(/Protein ≥ 150 g/);
  });

  // "No goals yet" is a claim about the account, and must not flash before the
  // first response makes it true.
  it("tells 'still loading' apart from 'you have no goals'", async () => {
    mockRows.targets = undefined;

    await render(<NutritionGoalsRoute />);

    expect(screen.getByTestId("settings.goals-empty")).toHaveTextContent("Loading your goals…");
  });

  it("says there are none once it knows there are none", async () => {
    await render(<NutritionGoalsRoute />);

    expect(screen.getByTestId("settings.goals-empty")).toHaveTextContent(/No goals yet/);
  });

  // Hiding a paused goal would make the screen look like it was deleted, and
  // the tuned number would be silently unrecoverable.
  it("keeps a paused goal on screen, marked", async () => {
    mockRows.targets = [row({ active: false })];

    await render(<NutritionGoalsRoute />);

    expect(screen.getByText("Paused")).toBeOnTheScreen();
    expect(screen.getByTestId("settings.goal-pause.1003-day")).toHaveTextContent("Resume");
  });

  // A required goal removes recipes. That has to be visible on the row.
  it("marks a required goal as required", async () => {
    mockRows.targets = [row({ hard: true })];

    await render(<NutritionGoalsRoute />);

    expect(screen.getByText("Required")).toBeOnTheScreen();
    expect(screen.getByTestId("settings.goal-hard.1003-day")).toHaveTextContent("Preferred");
  });
});

describe("editing a stored goal", () => {
  beforeEach(() => {
    mockRows.targets = [row()];
  });

  it("pauses a goal rather than deleting it", async () => {
    await render(<NutritionGoalsRoute />);

    await fireEvent.press(screen.getByTestId("settings.goal-pause.1003-day"));

    await waitFor(() => expect(mockSetActive).toHaveBeenCalledWith({ id: "t1", active: false }));
  });

  it("promotes a preference to a required constraint", async () => {
    await render(<NutritionGoalsRoute />);

    await fireEvent.press(screen.getByTestId("settings.goal-hard.1003-day"));

    await waitFor(() => expect(mockSetHard).toHaveBeenCalledWith({ id: "t1", hard: true }));
  });

  it("removes a goal by its id", async () => {
    await render(<NutritionGoalsRoute />);

    await fireEvent.press(screen.getByTestId("settings.goal-remove.1003-day"));

    await waitFor(() => expect(mockRemove).toHaveBeenCalledWith({ id: "t1" }));
  });

  it("surfaces a failed write", async () => {
    mockRemove.mockRejectedValue(new Error("Target not found"));

    await render(<NutritionGoalsRoute />);
    await fireEvent.press(screen.getByTestId("settings.goal-remove.1003-day"));

    expect(await screen.findByTestId("settings.goals-error")).toHaveTextContent("Target not found");
  });
});

describe("adding a goal", () => {
  // The three <select>s web uses become chip rows; same values, same words.
  it("offers the shared nutrient catalog and the shared windows", async () => {
    await render(<NutritionGoalsRoute />);

    expect(screen.getByTestId("settings.goal-nutrient.n-1093")).toHaveTextContent("Sodium");
    expect(screen.getByTestId("settings.goal-operator.at-most")).toHaveTextContent("at most");
    expect(screen.getByTestId("settings.goal-period.week")).toHaveTextContent("week");
  });

  // Number("") is 0, which would store "at most 0 mg of sodium" for someone who
  // tabbed past the field.
  it("will not store a goal with no amount", async () => {
    await render(<NutritionGoalsRoute />);

    await fireEvent.press(screen.getByTestId("settings.goal-add"));

    expect(mockAdd).not.toHaveBeenCalled();
  });

  it("stores what was drafted, and clears the amount for the next one", async () => {
    await render(<NutritionGoalsRoute />);

    await fireEvent.press(screen.getByTestId("settings.goal-nutrient.n-1093"));
    await fireEvent.press(screen.getByTestId("settings.goal-operator.at-most"));
    await fireEvent.changeText(screen.getByTestId("settings.goal-amount"), "2300");
    await fireEvent.press(screen.getByTestId("settings.goal-add"));

    await waitFor(() =>
      expect(mockAdd).toHaveBeenCalledWith({
        nutrientId: "1093",
        operator: "<=",
        value: 2300,
        period: "day",
      }),
    );
    expect(screen.getByTestId("settings.goal-amount")).toHaveDisplayValue("");
  });

  it("labels the amount field with the drafted nutrient's unit", async () => {
    await render(<NutritionGoalsRoute />);

    await fireEvent.press(screen.getByTestId("settings.goal-nutrient.n-1093"));

    expect(screen.getByText("Amount (mg)")).toBeOnTheScreen();
  });
});

describe("diet presets", () => {
  // Nothing downstream knows a diet exists: applying one writes ordinary rows,
  // which is why a new preset is an entry in a JSON file and no code at all.
  it("applies a preset as the rows it is made of", async () => {
    await render(<NutritionGoalsRoute />);

    const button = screen.getByTestId("settings.goal-preset.high-protein");
    await fireEvent.press(button);

    await waitFor(() =>
      expect(mockApplyPreset).toHaveBeenCalledWith({ targets: expect.any(Array) }),
    );
  });
});
