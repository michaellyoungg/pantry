import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

/**
 * `convex/react` is mocked; `useHome()` is not.
 *
 * The screen is presentation over the shared hook, so what is worth proving is
 * that the *real* state machine drives it — the same code the web dashboard
 * renders from (BL-0017). A fake hook here would test a copy of it and pass
 * whatever this screen happened to expect.
 *
 * `jest.mock` is hoisted above the imports, so the factory may only close over
 * names prefixed `mock`.
 */
const mockState = {
  basket: [] as Array<Record<string, unknown>> | undefined,
  list: [] as Array<Record<string, unknown>> | undefined,
  pantry: [] as Array<Record<string, unknown>>,
};
const mockGenerate = jest.fn(async () => ({ count: 3 }) as unknown);
const mockRecommend = jest.fn(async () => ({ results: [], generated: [] }) as unknown);
const mockNavigate = jest.fn();

jest.mock("convex/react", () => {
  // Function references are lazily-built proxies, so identity comparison is not
  // reliable — the function's name is.
  const { getFunctionName } = require("convex/server");
  const noop = () => Promise.resolve();
  return {
    useQuery: (ref: never) => {
      const name = getFunctionName(ref);
      if (name.startsWith("basket")) return mockState.basket;
      if (name.startsWith("pantry")) return mockState.pantry;
      return mockState.list;
    },
    useAction: (ref: never) =>
      getFunctionName(ref).startsWith("recommendations") ? mockRecommend : mockGenerate,
    useMutation: () => Object.assign(noop, { withOptimisticUpdate: () => noop }),
  };
});

// Routing is the screen's own concern (rule 5 keeps routers out of shared
// code), so it is also the screen's job to prove it routes to the right place.
jest.mock("expo-router", () => ({ useRouter: () => ({ navigate: mockNavigate }) }));

// The tab navigator renders no header, so the screen reads the top inset
// itself. There is no native safe-area module in a Node test process.
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }),
}));

import { HomeScreen } from "./HomeScreen";

/**
 * Presses a target and lets whatever it started settle.
 *
 * Building the list goes through `useAsyncAction`, which sets state when its
 * promise resolves — after the synchronous press has returned. Wrapping the
 * press keeps that update inside `act()` rather than leaking a warning that
 * would drown out a real one.
 */
async function press(testID: string) {
  await fireEvent.press(screen.getByTestId(testID));
}

function meal(id: string, over: Record<string, unknown> = {}) {
  return {
    _id: id,
    _creationTime: 0,
    userId: "u1",
    recipeId: `r-${id}`,
    title: `Recipe ${id}`,
    ...over,
  };
}

function line(id: string, checked: boolean) {
  return { _id: id, _creationTime: 0, userId: "u1", item: `item-${id}`, checked };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockState.basket = [];
  mockState.list = [];
  mockState.pantry = [];
});

describe("the home route", () => {
  it("is a real screen now, not the placeholder", async () => {
    await render(<HomeScreen />);

    expect(screen.getByTestId("home.screen")).toBeOnTheScreen();
    expect(screen.getByTestId("home.title")).toHaveTextContent("Pantry");
    expect(screen.queryByTestId("home.placeholder")).toBeNull();
  });

  it("offers exactly one next action", async () => {
    mockState.basket = [meal("a")];
    await render(<HomeScreen />);

    expect(screen.getAllByTestId("home.next-action")).toHaveLength(1);
  });
});

describe("HomeScreen — the next action", () => {
  it("waits for both queries rather than claiming the week is empty", async () => {
    mockState.basket = undefined;
    await render(<HomeScreen />);

    expect(screen.getByTestId("home.next-action-loading")).toBeOnTheScreen();
    expect(screen.queryByTestId("home.plan-week")).toBeNull();
  });

  it("offers planning when nothing is planned", async () => {
    await render(<HomeScreen />);

    expect(screen.getByTestId("home.next-action-heading")).toHaveTextContent("Start your week");
    await press("home.plan-week");
    expect(mockNavigate).toHaveBeenCalledWith("/plan");
  });

  it("offers building the list once the week has meals", async () => {
    mockState.basket = [meal("a"), meal("b")];
    await render(<HomeScreen />);

    expect(screen.getByTestId("home.build-list")).toHaveTextContent("Build grocery list (2 meals)");
  });

  it("excludes leftovers from the meal count, because they generate no lines", async () => {
    mockState.basket = [meal("a"), meal("b", { type: "leftover" })];
    await render(<HomeScreen />);

    expect(screen.getByTestId("home.build-list")).toHaveTextContent("Build grocery list (1 meal)");
  });

  it("hands off to shopping when a list exists", async () => {
    mockState.list = [line("1", true), line("2", false), line("3", false)];
    await render(<HomeScreen />);

    expect(screen.getByTestId("home.next-action-heading")).toHaveTextContent("Shopping day");
    expect(screen.getByTestId("home.shop")).toHaveTextContent("Shop 2 items");

    await press("home.shop");
    expect(mockNavigate).toHaveBeenCalledWith("/list");
  });

  it("closes the loop once everything is checked off", async () => {
    mockState.list = [line("1", true)];
    await render(<HomeScreen />);

    expect(screen.getByTestId("home.next-action-heading")).toHaveTextContent("Shopping done");
    expect(screen.getByTestId("home.plan-week")).toBeOnTheScreen();
  });

  // Regression, ported with the state machine: nothing clears a fully-checked
  // list, so "shopped" persists into the next week's planning. If it only
  // offered "Plan next week", building would be unreachable from the launch
  // screen for the rest of the week.
  it("still offers to build a list while shopped with a planned week", async () => {
    mockState.basket = [meal("a"), meal("b")];
    mockState.list = [line("1", true)];
    await render(<HomeScreen />);

    expect(screen.getByTestId("home.build-list")).toHaveTextContent(
      "Rebuild grocery list (2 meals)",
    );
  });

  it("omits the rebuild action when shopped with nothing planned", async () => {
    mockState.list = [line("1", true)];
    await render(<HomeScreen />);

    expect(screen.queryByTestId("home.build-list")).toBeNull();
  });
});

describe("HomeScreen — building the list", () => {
  it("generates the list and lands on it, ready to shop", async () => {
    mockState.basket = [meal("a")];
    await render(<HomeScreen />);

    await press("home.build-list");

    expect(mockGenerate).toHaveBeenCalledWith({});
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/list"));
  });

  it("surfaces the failure and stays put when generating fails", async () => {
    mockState.basket = [meal("a")];
    mockGenerate.mockRejectedValueOnce(new Error("recipe-service unreachable") as never);
    await render(<HomeScreen />);

    await press("home.build-list");

    await waitFor(() =>
      expect(screen.getByTestId("home.next-action-error")).toHaveTextContent(
        "recipe-service unreachable",
      ),
    );
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

describe("HomeScreen — the week strip", () => {
  it("shows planned dinners on their day and an add affordance elsewhere", async () => {
    mockState.basket = [meal("a", { weekday: 0, title: "Chili" })];
    await render(<HomeScreen />);

    expect(screen.getByTestId("home.day.mon")).toHaveTextContent(/Mon.*Chili/);
    expect(screen.getByTestId("home.day.tue")).toHaveTextContent(/Tue.*\+ add/);
  });

  it("marks leftover days as leftovers, in the label a screen reader reads too", async () => {
    mockState.basket = [meal("a", { weekday: 2, title: "Chili", type: "leftover" })];
    await render(<HomeScreen />);

    const wednesday = screen.getByTestId("home.day.wed");
    expect(wednesday).toHaveTextContent(/Chili \(leftovers\)/);
    expect(wednesday.props.accessibilityLabel).toBe("Wednesday — Chili (leftovers)");
  });

  // Unscheduled rows appear in no day row but still count toward "N meals
  // ready", so the strip has to account for them or the two contradict.
  it("accounts for meals that are not on a day yet", async () => {
    mockState.basket = [meal("a", { weekday: 0 }), meal("b"), meal("c")];
    await render(<HomeScreen />);

    expect(screen.getByTestId("home.unscheduled")).toHaveTextContent("2 meals not on a day yet");
  });

  it("says nothing about unscheduled meals when every meal has a day", async () => {
    mockState.basket = [meal("a", { weekday: 0 })];
    await render(<HomeScreen />);

    expect(screen.queryByTestId("home.unscheduled")).toBeNull();
  });

  it("routes a day to the planner", async () => {
    await render(<HomeScreen />);

    await press("home.day.sun");

    expect(mockNavigate).toHaveBeenCalledWith("/plan");
  });
});

describe("HomeScreen — quick actions and onboarding", () => {
  it("offers only shortcuts this client can actually reach", async () => {
    await render(<HomeScreen />);

    await press("home.quick-action.open-grocery-list");
    expect(mockNavigate).toHaveBeenCalledWith("/list");

    await press("home.quick-action.import-a-recipe");
    expect(mockNavigate).toHaveBeenCalledWith("/recipes");
  });

  it("checks off the first step once the week is planned", async () => {
    mockState.basket = [meal("a")];
    await render(<HomeScreen />);

    expect(screen.getByTestId("home.step.add-meals-to-your-week")).toHaveTextContent(
      "Add meals to your week",
    );
    expect(screen.getByTestId("home.step.add-meals-to-your-week").props.className).toContain(
      "line-through",
    );
  });

  it("hides onboarding once shopping has started", async () => {
    mockState.list = [line("1", false)];
    await render(<HomeScreen />);

    expect(screen.queryByTestId("home.getting-started")).toBeNull();
  });
});

describe("HomeScreen — the expiry nudge", () => {
  it("interrupts only when there is food about to be wasted", async () => {
    await render(<HomeScreen />);

    expect(screen.queryByTestId("pantry.use-it-up")).toBeNull();
    expect(mockRecommend).not.toHaveBeenCalled();
  });

  it("surfaces the batch on the surface that answers 'what do I do now'", async () => {
    mockState.pantry = [
      {
        _id: "p1",
        _creationTime: 0,
        userId: "u1",
        canonicalItem: "spinach",
        display: "Spinach",
        aisle: "produce",
        state: "have",
        source: "auto",
        updatedAt: 0,
        useBy: Date.now() + 2 * 86_400_000,
      },
    ];
    await render(<HomeScreen />);

    expect(screen.getByTestId("pantry.use-it-up-heading")).toHaveTextContent(
      "1 item to use this week",
    );
    await waitFor(() => expect(mockRecommend).toHaveBeenCalled());
  });
});
