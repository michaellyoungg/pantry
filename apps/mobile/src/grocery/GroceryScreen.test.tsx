import { CART_TRANSITION_MS } from "@pantry/core/data";
import { act, fireEvent, render, screen } from "@testing-library/react-native";

/**
 * `convex/react` is mocked; `useGroceryList()` is not.
 *
 * The screen is presentation over the shared hook, so the thing worth proving
 * is that the *real* hook drives it — the same code the web screen renders
 * from. Substituting a fake hook here would test a copy of the state machine
 * and pass whatever this screen happened to expect.
 *
 * `jest.mock` is hoisted above the imports, so the factory may only close over
 * names prefixed `mock`.
 */
const mockState = {
  lines: undefined as Array<Record<string, unknown>> | undefined,
  leftovers: [] as Array<Record<string, unknown>>,
  recent: [] as Array<Record<string, unknown>>,
};
// Every mutation lands here tagged with its function name, so one spy covers
// all of them and an assertion still says which one it means.
const mockMutation = jest.fn((_name: string, _args: unknown) => Promise.resolve(null));
const mockAction = jest.fn((_args: unknown) => Promise.resolve(null));

/**
 * A stand-in for one `useMutation` result, tagged with the function it stands
 * for. Built out here rather than inside the factory: a type annotation inside
 * a `jest.mock` factory reads to Babel's hoist check as an out-of-scope
 * variable reference, and the suite then fails to load at all.
 */
const mockMutationFor = (name: string) => {
  const fn = (args: unknown) => mockMutation(name, args);
  fn.withOptimisticUpdate = () => fn;
  return fn;
};

jest.mock("convex/react", () => {
  // Function references are lazily-built proxies, so identity comparison is not
  // reliable — the function's name is.
  const { getFunctionName } = require("convex/server");
  return {
    useQuery: (query: never) => {
      const name = getFunctionName(query);
      if (name.includes("leftoverProposals")) return mockState.leftovers;
      if (name.includes("recentItems")) return mockState.recent;
      return mockState.lines;
    },
    useMutation: (ref: never) => mockMutationFor(getFunctionName(ref)),
    useAction: () => mockAction,
  };
});

import { GroceryScreen } from "./GroceryScreen";

// RNTL 14 made `render` and `fireEvent` async: they await React 19's `act`
// internally, and `screen` is only bound once that settles. Dropping an `await`
// does not fail loudly — the next line throws ``render` function has not been
// called``, which reads like the component never mounted.

function line(over: Record<string, unknown> = {}) {
  return {
    _id: "g1",
    _creationTime: 0,
    userId: "dev-user",
    item: "Parsley",
    canonicalItem: "parsley",
    unit: "tbsp",
    quantity: 2,
    aisle: "produce",
    checked: false,
    ...over,
  };
}

/**
 * Presses a target and lets the resulting mutation settle.
 *
 * Every action on this screen goes through `useAsyncAction`, which sets state
 * when its promise resolves — after the synchronous press has returned. Wrapping
 * the press keeps that update inside `act()` rather than leaking a warning that
 * would drown out a real one.
 */
async function press(testID: string) {
  await fireEvent.press(screen.getByTestId(testID));
}

/** The mutation call for `name`, or undefined if it was never made. */
function callTo(name: string) {
  return mockMutation.mock.calls.find(([called]) => called.endsWith(name))?.[1];
}

beforeEach(() => {
  jest.clearAllMocks();
  mockState.lines = [line()];
  mockState.leftovers = [];
  mockState.recent = [];
});
afterEach(() => jest.useRealTimers());

describe("GroceryScreen — the aisle walk", () => {
  it("waits for the first response rather than claiming the list is empty", async () => {
    mockState.lines = undefined;
    await render(<GroceryScreen />);

    expect(screen.getByTestId("list.loading")).toBeTruthy();
    expect(screen.queryByTestId("list.empty-state")).toBeNull();
  });

  it("says the list is empty once it knows that it is", async () => {
    mockState.lines = [];
    await render(<GroceryScreen />);

    expect(screen.getByTestId("list.empty-state")).toBeTruthy();
    expect(screen.queryByTestId("list.loading")).toBeNull();
  });

  it("groups the walk by aisle, title-cased and counted", async () => {
    mockState.lines = [
      line({ _id: "a", item: "Parsley", aisle: "produce" }),
      line({ _id: "b", item: "Lemon", aisle: "produce" }),
      line({ _id: "c", item: "Butter", aisle: "dairy and eggs" }),
    ];
    await render(<GroceryScreen />);

    expect(screen.getByTestId("list.aisle-header.produce")).toHaveTextContent(/Produce.*2/);
    expect(screen.getByTestId("list.aisle-header.dairy-and-eggs")).toHaveTextContent(
      /Dairy and eggs.*1/,
    );
  });

  it("pins each aisle header so it stays legible while the list scrolls under it", async () => {
    // A shopper looking up from a shelf needs to know which section they are
    // in; a header that has scrolled away answers only when nobody is asking.
    mockState.lines = [
      line({ _id: "a", aisle: "produce" }),
      line({ _id: "b", item: "Butter", aisle: "dairy" }),
    ];
    await render(<GroceryScreen />);

    expect(screen.getByTestId("list.aisle-walk").props.stickyHeaderIndices).toHaveLength(2);
  });

  it("checks a line off against the row the shopper actually tapped", async () => {
    await render(<GroceryScreen />);

    await press("list.toggle.parsley");

    expect(callTo("toggleItem")).toEqual({ id: "g1", checked: true });
  });

  it("keeps a ticked line in the walk while it animates, so the tap is seen landing", async () => {
    await render(<GroceryScreen />);

    mockState.lines = [line({ checked: true })];
    await screen.rerender(<GroceryScreen />);

    // Still in the walk, not teleported into the cart section below.
    expect(screen.getByTestId("list.aisle-header.produce")).toHaveTextContent(/Produce.*1/);
    expect(screen.queryByTestId("list.in-cart-section")).toBeNull();
  });
});

describe("GroceryScreen — what a line says", () => {
  it("shows the pack to buy and the measure the recipes wanted", async () => {
    mockState.lines = [line({ purchase: { quantity: 1, unit: "bunch" } })];
    await render(<GroceryScreen />);

    expect(screen.getByTestId("list.buy.parsley")).toHaveTextContent("1 bunch Parsley");
    expect(screen.getByTestId("list.need.parsley")).toHaveTextContent("needs 2 tbsp");
  });

  it("opens the provenance of a merged line, and closes again", async () => {
    mockState.lines = [
      line({
        sources: [
          { recipeId: "r1", title: "Green Soup", quantity: 1 },
          { recipeId: "r2", title: "Herb Salad", quantity: 1 },
        ],
      }),
    ];
    await render(<GroceryScreen />);

    await press("list.provenance.parsley");
    expect(screen.getByTestId("list.provenance-source.green-soup")).toHaveTextContent(/1 tbsp/);
    expect(screen.getByTestId("list.provenance-source.herb-salad")).toBeTruthy();

    await press("list.provenance-close");
    expect(screen.queryByTestId("list.provenance-sheet")).toBeNull();
  });

  it("lets a line the pantry already covers be wanted anyway", async () => {
    mockState.lines = [line({ alreadyHave: true })];
    await render(<GroceryScreen />);

    await press("list.need-it-anyway.parsley");

    expect(callTo("needItAnyway")).toEqual({ id: "g1" });
  });
});

describe("GroceryScreen — the cart and the dropped half", () => {
  it("collects checked-off lines into their own section once they have left the walk", async () => {
    jest.useFakeTimers();
    await render(<GroceryScreen />);

    mockState.lines = [line({ checked: true })];
    await screen.rerender(<GroceryScreen />);
    await act(async () => {
      jest.advanceTimersByTime(CART_TRANSITION_MS + 50);
    });

    expect(screen.getByTestId("list.in-cart-section")).toHaveTextContent(/In cart.*1/);
  });

  it("keeps a line the plan dropped after it was bought, apart and dismissable", async () => {
    mockState.lines = [line({ checked: true, removed: true })];
    await render(<GroceryScreen />);

    expect(screen.getByTestId("list.dropped-section")).toHaveTextContent(/No longer in your plan/);
    await press("list.dismiss.parsley");

    expect(callTo("removeItem")).toEqual({ id: "g1" });
  });

  it("offers to undo a delete, and puts the whole line back", async () => {
    mockState.lines = [line({ manual: true })];
    await render(<GroceryScreen />);

    await press("list.remove.parsley");
    expect(screen.getByTestId("list.undo")).toHaveTextContent(/Removed Parsley/);

    await press("list.undo-button");
    expect(callTo("restoreItem")).toEqual({
      line: expect.objectContaining({ item: "Parsley", manual: true }),
    });
  });
});

describe("GroceryScreen — leftovers", () => {
  const parsley = {
    _id: "g9",
    item: "Parsley",
    quantity: 2,
    unit: "tbsp",
    purchase: { quantity: 1, unit: "bunch", residue: 6, residueUnit: "tbsp" },
  };

  it("shows its own arithmetic, so the guess is inspectable", async () => {
    mockState.leftovers = [parsley];
    await render(<GroceryScreen />);

    expect(screen.getByTestId("list.leftover.parsley")).toHaveTextContent(
      /6 tbsp of the 1 bunch you bought, after the 2 tbsp your recipes wanted/,
    );
  });

  it("answers one guess at a time, with no bulk answer anywhere", async () => {
    mockState.leftovers = [parsley, { ...parsley, _id: "g10", item: "Buttermilk" }];
    await render(<GroceryScreen />);

    await press("list.leftover-keep.parsley");
    expect(callTo("resolveLeftover")).toEqual({ id: "g9", keep: true });
    expect(screen.getByTestId("list.leftover-dismiss.buttermilk")).toBeTruthy();
  });

  it("dismisses one without writing a leftover", async () => {
    mockState.leftovers = [parsley];
    await render(<GroceryScreen />);

    await press("list.leftover-dismiss.parsley");

    expect(callTo("resolveLeftover")).toEqual({ id: "g9", keep: false });
  });

  it("says nothing at all when there is nothing to propose", async () => {
    await render(<GroceryScreen />);
    expect(screen.queryByTestId("list.leftovers")).toBeNull();
  });
});

describe("GroceryScreen — the thumb zone", () => {
  it("keeps the trip's state visible without scrolling to it", async () => {
    mockState.lines = [line({ _id: "a" }), line({ _id: "b", item: "Lemon", checked: true })];
    await render(<GroceryScreen />);

    expect(screen.getByTestId("list.progress")).toHaveTextContent(/1 of 2 in cart/);
  });

  it("adds what the shopper typed, split by the shared parser", async () => {
    await render(<GroceryScreen />);

    await press("list.add-toggle");
    await fireEvent.changeText(screen.getByTestId("list.add-field"), "2 lb butter");
    await press("list.add-submit");

    expect(mockAction).toHaveBeenCalledWith({ quantity: 2, unit: "lb", item: "butter" });
  });

  it("keeps the add field out of the way until it is asked for", async () => {
    await render(<GroceryScreen />);
    expect(screen.queryByTestId("list.add-field")).toBeNull();

    await press("list.add-toggle");
    expect(screen.getByTestId("list.add-field")).toBeTruthy();

    await press("list.add-toggle");
    expect(screen.queryByTestId("list.add-field")).toBeNull();
  });

  it("cannot end a trip that never started", async () => {
    mockState.lines = [];
    await render(<GroceryScreen />);

    expect(screen.getByTestId("list.done-shopping").props.accessibilityState.disabled).toBe(true);
  });
});

describe("GroceryScreen — ending the trip", () => {
  it("says what each half of the list is about to become", async () => {
    mockState.lines = [line({ _id: "a" }), line({ _id: "b", item: "Lemon", checked: true })];
    mockState.leftovers = [{ _id: "g9", item: "Parsley", quantity: 2, unit: "tbsp" }];
    await render(<GroceryScreen />);

    await press("list.done-shopping");

    expect(screen.getByTestId("list.finish-in-cart")).toHaveTextContent(/1 item is in your cart/);
    expect(screen.getByTestId("list.finish-unbought")).toHaveTextContent(
      /1 item is still unbought/,
    );
    expect(screen.getByTestId("list.finish-leftovers")).toHaveTextContent(
      /1 leftover question will close unanswered/,
    );
  });

  it("keeps what was not bought", async () => {
    await render(<GroceryScreen />);

    await press("list.done-shopping");
    await press("list.finish-keep");

    expect(callTo("finishShopping")).toEqual({ unbought: "keep" });
  });

  it("clears the whole list when that is what was meant", async () => {
    await render(<GroceryScreen />);

    await press("list.done-shopping");
    await press("list.finish-remove");

    expect(callTo("finishShopping")).toEqual({ unbought: "remove" });
  });

  it("backs out without finishing anything", async () => {
    await render(<GroceryScreen />);

    await press("list.done-shopping");
    await press("list.finish-cancel");

    expect(screen.queryByTestId("list.finish-sheet")).toBeNull();
    expect(callTo("finishShopping")).toBeUndefined();
  });

  it("asks before clearing, and does nothing if the answer is no", async () => {
    await render(<GroceryScreen />);

    await press("list.clear");
    await press("list.confirm-cancel");
    expect(callTo("clearGroceryList")).toBeUndefined();

    await press("list.clear");
    await press("list.confirm-clear");
    expect(callTo("clearGroceryList")).toEqual({});
  });
});

describe("GroceryScreen — failure", () => {
  it("surfaces a failed mutation rather than silently not doing it", async () => {
    mockMutation.mockRejectedValueOnce(new Error("offline"));
    await render(<GroceryScreen />);

    await press("list.toggle.parsley");

    expect(screen.getByTestId("list.error")).toHaveTextContent(/offline/);
  });
});
