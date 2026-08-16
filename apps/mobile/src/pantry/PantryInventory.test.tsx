import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

const DAY = 86_400_000;

// `jest.mock` is hoisted above this file's imports, so the factory may only
// close over names prefixed `mock`.
const mockState = { rows: undefined as unknown[] | undefined };
const mockSetState = jest.fn(() => Promise.resolve());
const mockSetUseItUp = jest.fn(() => Promise.resolve());
const mockRemove = jest.fn(() => Promise.resolve());

// The screen drives three different mutations, so the mock has to tell them
// apart. anyApi references are fresh proxies on every access, so identity
// comparison would silently always pick the same branch; the NAME is stable.
jest.mock("convex/react", () => {
  const { getFunctionName } = require("convex/server");
  return {
    useQuery: () => mockState.rows,
    useMutation: (ref: unknown) => {
      const name = getFunctionName(ref as never);
      const spy = name.endsWith("setUseItUp")
        ? mockSetUseItUp
        : name.endsWith("remove")
          ? mockRemove
          : mockSetState;
      const fn = ((...args: unknown[]) => spy(...(args as []))) as unknown as {
        (...a: unknown[]): Promise<unknown>;
        withOptimisticUpdate: (u: unknown) => typeof fn;
      };
      fn.withOptimisticUpdate = () => fn;
      return fn;
    },
  };
});

import { PantryInventory } from "./PantryInventory";

function row(over: Record<string, unknown> = {}) {
  return {
    _id: `p-${(over.canonicalItem as string) ?? "spinach"}`,
    _creationTime: 0,
    userId: "u1",
    canonicalItem: "spinach",
    display: "Spinach",
    aisle: "produce",
    state: "have",
    source: "auto",
    updatedAt: 0,
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockState.rows = [];
});

describe("what the pantry currently holds", () => {
  it("tells 'still loading' apart from 'you own nothing'", () => {
    mockState.rows = undefined;

    render(<PantryInventory />);

    expect(screen.getByTestId("pantry.loading")).toBeOnTheScreen();
    expect(screen.queryByTestId("pantry.empty-state")).toBeNull();
  });

  it("explains where inventory comes from when there is none", () => {
    render(<PantryInventory />);

    expect(screen.getByTestId("pantry.empty-state")).toHaveTextContent(/grocery list/i);
    // Nothing is suppressed yet, so the don't-rebuy note would be a lie.
    expect(screen.queryByTestId("pantry.rebuy-note")).toBeNull();
  });

  it("groups rows under their aisle, in the server's order", () => {
    mockState.rows = [
      row({ canonicalItem: "milk", display: "Milk", aisle: "dairy" }),
      row({ canonicalItem: "butter", display: "Butter", aisle: "dairy" }),
      row({ canonicalItem: "green onion", display: "Green onion", aisle: "produce" }),
    ];

    render(<PantryInventory />);

    expect(screen.getByTestId("pantry.aisle.dairy")).toHaveTextContent("Dairy");
    expect(screen.getByTestId("pantry.aisle.produce")).toHaveTextContent("Produce");
    // Keyed on the item, not on where it sits: a row that moves aisle or
    // position keeps the same selector.
    expect(screen.getByTestId("pantry.item-name.green-onion")).toHaveTextContent("Green onion");
  });

  it("says plainly what the Have state does to the next grocery list", () => {
    mockState.rows = [row()];

    render(<PantryInventory />);

    expect(screen.getByTestId("pantry.rebuy-note")).toHaveTextContent(/skipped/i);
  });
});

describe("the state cycle", () => {
  // These press a control that fires a mutation, and `useAsyncAction` flips its
  // pending flag when the promise settles — after the synchronous assertion
  // would have run. Awaiting `waitFor` lets that update land inside act().
  it("advances have → low", async () => {
    mockState.rows = [row({ state: "have" })];

    render(<PantryInventory />);
    fireEvent.press(screen.getByTestId("pantry.state.spinach"));

    await waitFor(() =>
      expect(mockSetState).toHaveBeenCalledWith({ id: "p-spinach", state: "low" }),
    );
  });

  it("wraps out → have, so restocking never needs a different control", async () => {
    mockState.rows = [row({ state: "out" })];

    render(<PantryInventory />);
    fireEvent.press(screen.getByTestId("pantry.state.spinach"));

    await waitFor(() =>
      expect(mockSetState).toHaveBeenCalledWith({ id: "p-spinach", state: "have" }),
    );
  });

  it("labels the control with the state it is in, for a screen reader too", () => {
    mockState.rows = [row({ state: "low" })];

    render(<PantryInventory />);

    const control = screen.getByTestId("pantry.state.spinach");
    expect(control).toHaveTextContent("Low");
    expect(control.props.accessibilityLabel).toBe("Spinach is: low. Change.");
  });
});

describe("marking something to use up", () => {
  it("flips the flag the ranker reads", async () => {
    mockState.rows = [row({ useItUp: false })];

    render(<PantryInventory />);
    fireEvent.press(screen.getByTestId("pantry.use-up.spinach"));

    await waitFor(() =>
      expect(mockSetUseItUp).toHaveBeenCalledWith({ id: "p-spinach", useItUp: true }),
    );
  });

  it("unflips an already-flagged item", async () => {
    mockState.rows = [row({ useItUp: true })];

    render(<PantryInventory />);
    expect(screen.getByTestId("pantry.use-up.spinach").props.accessibilityState.selected).toBe(
      true,
    );

    fireEvent.press(screen.getByTestId("pantry.use-up.spinach"));
    await waitFor(() =>
      expect(mockSetUseItUp).toHaveBeenCalledWith({ id: "p-spinach", useItUp: false }),
    );
  });
});

describe("removing an item", () => {
  it("asks before destroying the row, rather than firing on a mis-tap", () => {
    mockState.rows = [row()];

    render(<PantryInventory />);
    fireEvent.press(screen.getByTestId("pantry.remove.spinach"));

    expect(mockRemove).not.toHaveBeenCalled();
    expect(screen.getByTestId("pantry.confirm-remove.spinach")).toBeOnTheScreen();
  });

  it("removes once confirmed", async () => {
    mockState.rows = [row()];

    render(<PantryInventory />);
    fireEvent.press(screen.getByTestId("pantry.remove.spinach"));
    fireEvent.press(screen.getByTestId("pantry.confirm-remove.spinach"));

    await waitFor(() => expect(mockRemove).toHaveBeenCalledWith({ id: "p-spinach" }));
    expect(screen.queryByTestId("pantry.confirm-remove.spinach")).toBeNull();
  });

  it("backs out on Keep", () => {
    mockState.rows = [row()];

    render(<PantryInventory />);
    fireEvent.press(screen.getByTestId("pantry.remove.spinach"));
    fireEvent.press(screen.getByTestId("pantry.cancel-remove.spinach"));

    expect(mockRemove).not.toHaveBeenCalled();
    expect(screen.getByTestId("pantry.remove.spinach")).toBeOnTheScreen();
  });

  it("prompts on one row at a time", () => {
    mockState.rows = [row(), row({ canonicalItem: "milk", display: "Milk" })];

    render(<PantryInventory />);
    fireEvent.press(screen.getByTestId("pantry.remove.spinach"));
    fireEvent.press(screen.getByTestId("pantry.remove.milk"));

    expect(screen.getByTestId("pantry.confirm-remove.milk")).toBeOnTheScreen();
    expect(screen.queryByTestId("pantry.confirm-remove.spinach")).toBeNull();
  });
});

describe("when a mutation fails", () => {
  it("says so, rather than leaving a tap that silently did nothing", async () => {
    mockState.rows = [row()];
    mockSetState.mockRejectedValueOnce(new Error("offline"));

    render(<PantryInventory />);
    fireEvent.press(screen.getByTestId("pantry.state.spinach"));

    expect(await screen.findByTestId("pantry.error")).toHaveTextContent(/offline/);
  });
});

describe("shelf life", () => {
  it("shows an approximate, relative date — never one that looks printed", () => {
    // 2.5 days, not 2: the component reads its own `Date.now()` a few
    // milliseconds after this line, and whole days are floored, so an exact
    // two-day offset lands on "~tomorrow" about half the time.
    mockState.rows = [row({ useBy: Date.now() + 2.5 * DAY })];

    render(<PantryInventory />);

    expect(screen.getByTestId("pantry.use-by.spinach")).toHaveTextContent("~2 days");
  });

  it("calls out an item that is past its date in words, not only in colour", () => {
    mockState.rows = [row({ useBy: Date.now() - 2 * DAY })];

    render(<PantryInventory />);

    expect(screen.getByTestId("pantry.use-by.spinach")).toHaveTextContent(/past its date/i);
  });

  it("shows no date at all for an item with no known shelf life", () => {
    // A guessed date is worse than an absent one.
    mockState.rows = [row({ canonicalItem: "salt", display: "Salt", useBy: undefined })];

    render(<PantryInventory />);

    expect(screen.getByTestId("pantry.item.salt")).toBeOnTheScreen();
    expect(screen.queryByTestId("pantry.use-by.salt")).toBeNull();
  });
});
