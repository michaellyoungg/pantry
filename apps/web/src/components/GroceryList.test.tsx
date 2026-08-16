import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted, mutable so each test can set the query result; one shared mutation spy.
const { state, mutationMock } = vi.hoisted(() => ({
  state: {
    lines: [] as Array<Record<string, unknown>>,
    leftovers: [] as Array<Record<string, unknown>>,
  },
  mutationMock: vi.fn(() => Promise.reject(new Error("mutation failed"))),
}));

// The add field runs its own query and action and is covered by its own suite;
// stubbing it keeps this file about the list.
vi.mock("./GroceryAddItem", () => ({
  GroceryAddItem: () => <div data-testid="add-item" />,
}));

// Same for the leftovers prompt: it runs its own query and has its own suite.
vi.mock("./LeftoverProposals", () => ({
  LeftoverProposals: () => <div data-testid="leftover-proposals" />,
}));

// And for presence, which heartbeats on a timer of its own (BL-0019).
vi.mock("./ShoppingPresence", () => ({
  ShoppingPresence: () => <div data-testid="presence" />,
}));

// The provenance sheet links through to a recipe, which needs a router.
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: { children: React.ReactNode }) => <a {...props}>{children}</a>,
}));

vi.mock("convex/react", async () => {
  // Function references are lazily-built proxies, so identity comparison is not
  // reliable — the function's name is.
  const { getFunctionName } = await import("convex/server");
  return {
    useQuery: (query: never) =>
      getFunctionName(query).includes("leftoverProposals") ? state.leftovers : state.lines,
    // PricingSummary (BL-0023) runs an action; these tests are about the list,
    // so the estimate never resolves and the summary stays in its loading state.
    useAction: () => () => new Promise(() => {}),
    useMutation: () => {
      const fn = ((...args: unknown[]) =>
        (mutationMock as (...a: unknown[]) => Promise<unknown>)(...args)) as unknown as {
        (...a: unknown[]): Promise<unknown>;
        withOptimisticUpdate: (u: unknown) => typeof fn;
      };
      fn.withOptimisticUpdate = () => fn;
      return fn;
    },
  };
});

import { GroceryList } from "./GroceryList";

const oneLine = [
  {
    _id: "g1",
    userId: "dev-user",
    item: "egg",
    unit: "",
    quantity: 1,
    aisle: "other",
    checked: false,
    _creationTime: 0,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  state.lines = oneLine;
  state.leftovers = [];
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("GroceryList", () => {
  it("surfaces an inline error when toggling fails", async () => {
    render(<GroceryList />);
    fireEvent.click(screen.getByRole("checkbox"));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("mutation failed");
  });

  it("clears the list via the clear mutation when confirmed", async () => {
    render(<GroceryList />);
    fireEvent.click(screen.getByRole("button", { name: /clear list/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Clear" }));
    await waitFor(() => expect(mutationMock).toHaveBeenCalledTimes(1));
    expect(mutationMock).toHaveBeenCalledWith({}); // the clear mutation, args {}
    // the shared mock rejects → let the run() settle so no act warning
    await screen.findByRole("alert");
  });

  it("does not clear when confirmation is cancelled", async () => {
    render(<GroceryList />);
    fireEvent.click(screen.getByRole("button", { name: /clear list/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(mutationMock).not.toHaveBeenCalled();
  });

  it("hides the Clear list button when the list is empty", () => {
    state.lines = [];
    render(<GroceryList />);
    expect(screen.queryByRole("button", { name: /clear list/i })).toBeNull();
  });

  it("renders aisle section headers and groups lines under them", () => {
    state.lines = [
      {
        _id: "a",
        userId: "dev-user",
        item: "Milk",
        unit: "cup",
        quantity: 1,
        aisle: "dairy",
        checked: false,
        _creationTime: 0,
      },
      {
        _id: "b",
        userId: "dev-user",
        item: "Sriracha",
        unit: "tbsp",
        quantity: 2,
        aisle: "other",
        checked: false,
        _creationTime: 1,
      },
    ];
    render(<GroceryList />);
    expect(screen.getByText("Dairy")).toBeTruthy();
    expect(screen.getByText("Other")).toBeTruthy();
  });

  it("renders quantities as fraction glyphs", () => {
    state.lines = [
      {
        _id: "a",
        userId: "dev-user",
        item: "Butter",
        unit: "cup",
        quantity: 0.75,
        aisle: "dairy",
        checked: false,
        _creationTime: 0,
      },
    ];
    render(<GroceryList />);
    expect(screen.getByText(/¾ cup Butter/)).toBeTruthy();
  });

  it("groups consecutive same-aisle lines under a single header", () => {
    state.lines = [
      {
        _id: "a",
        userId: "dev-user",
        item: "Milk",
        unit: "cup",
        quantity: 1,
        aisle: "dairy",
        checked: false,
        _creationTime: 0,
      },
      {
        _id: "b",
        userId: "dev-user",
        item: "Butter",
        unit: "cup",
        quantity: 0.5,
        aisle: "dairy",
        checked: false,
        _creationTime: 1,
      },
    ];
    render(<GroceryList />);
    expect(screen.getAllByText("Dairy")).toHaveLength(1);
    expect(screen.getByText(/Milk/)).toBeTruthy();
    expect(screen.getByText(/Butter/)).toBeTruthy();
  });

  it("marks lines the user already owns", () => {
    state.lines = [{ ...oneLine[0], item: "butter", alreadyHave: true }];
    render(<GroceryList />);
    expect(screen.getByText(/already have/i)).toBeTruthy();
  });

  it("does not mark ordinary lines", () => {
    state.lines = [{ ...oneLine[0], alreadyHave: false }];
    render(<GroceryList />);
    expect(screen.queryByText(/already have/i)).toBeNull();
  });

  it("still renders owned lines in place, never hiding them", () => {
    state.lines = [
      { ...oneLine[0], _id: "g1", item: "butter", alreadyHave: true },
      { ...oneLine[0], _id: "g2", item: "milk", alreadyHave: false },
    ];
    render(<GroceryList />);
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
  });

  it("clears the flag via needItAnyway", () => {
    state.lines = [{ ...oneLine[0], item: "butter", alreadyHave: true }];
    render(<GroceryList />);
    fireEvent.click(screen.getByRole("button", { name: /need it anyway/i }));
    expect(mutationMock).toHaveBeenCalledWith({ id: "g1" });
  });
});

// BL-0019: a merged line is otherwise opaque — "3 cloves garlic" with no way
// back to which of the week's recipes wanted it.
describe("GroceryList provenance", () => {
  const withSources = [
    {
      ...oneLine[0],
      item: "Butter",
      unit: "cup",
      quantity: 0.75,
      aisle: "dairy",
      sources: [
        { recipeId: "r1", title: "Cookies", quantity: 0.25 },
        { recipeId: "r2", title: "Toast", quantity: 0.5 },
      ],
    },
  ];

  it("shows how many recipes a line came from", () => {
    state.lines = withSources;
    render(<GroceryList />);
    expect(screen.getByRole("button", { name: /2 recipes/i })).toBeTruthy();
  });

  it("opens a sheet naming the recipes and their amounts", async () => {
    state.lines = withSources;
    render(<GroceryList />);
    fireEvent.click(screen.getByRole("button", { name: /2 recipes/i }));

    const sheet = await screen.findByRole("dialog");
    expect(sheet.textContent).toContain("Cookies");
    expect(sheet.textContent).toContain("¼ cup");
    expect(sheet.textContent).toContain("Toast");
    expect(sheet.textContent).toContain("½ cup");
  });

  it("closes the sheet again", async () => {
    state.lines = withSources;
    render(<GroceryList />);
    fireEvent.click(screen.getByRole("button", { name: /2 recipes/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Close" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("offers no provenance for a line with no recipe behind it", () => {
    state.lines = [{ ...oneLine[0], manual: true }];
    render(<GroceryList />);
    expect(screen.queryByRole("button", { name: /recipes?$/i })).toBeNull();
  });
});

describe("GroceryList manual lines", () => {
  it("offers the add field from the thumb zone", () => {
    render(<GroceryList />);
    // Folded away at rest so the bottom bar stays small on a phone; one tap on
    // a control that is always in reach opens it.
    expect(screen.queryByTestId("add-item")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));
    expect(screen.getByTestId("add-item")).toBeTruthy();
  });

  it("removes a manual line", () => {
    state.lines = [{ ...oneLine[0], item: "Foil", manual: true }];
    render(<GroceryList />);
    fireEvent.click(screen.getByRole("button", { name: /remove foil/i }));
    expect(mutationMock).toHaveBeenCalledWith({ id: "g1" });
  });

  it("offers no remove on a generated line, which would just come back", () => {
    state.lines = [{ ...oneLine[0], item: "Garlic" }];
    render(<GroceryList />);
    expect(screen.queryByRole("button", { name: /remove/i })).toBeNull();
  });
});

describe("lines the plan has dropped (BL-0018)", () => {
  const removedLine = {
    _id: "g2",
    userId: "dev-user",
    item: "kale",
    unit: "bunch",
    quantity: 1,
    aisle: "produce",
    checked: true,
    removed: true,
    _creationTime: 0,
  };

  it("keeps a flagged line out of the aisles still being shopped", () => {
    state.lines = [...oneLine, removedLine];
    render(<GroceryList />);
    // Kale is the only produce line, so an aisle heading for it would mean the
    // flagged line is still being walked past in the store.
    expect(screen.queryByRole("heading", { name: /produce/i })).toBeNull();
    expect(screen.getByRole("heading", { name: /other/i })).toBeTruthy();
  });

  it("shows flagged lines under their own heading so nothing vanishes silently", () => {
    state.lines = [...oneLine, removedLine];
    render(<GroceryList />);
    expect(screen.getByText(/no longer in your plan/i)).toBeTruthy();
    expect(screen.getByText(/kale/)).toBeTruthy();
  });

  it("says nothing about removals when the plan dropped nothing", () => {
    state.lines = oneLine;
    render(<GroceryList />);
    expect(screen.queryByText(/no longer in your plan/i)).toBeNull();
  });

  it("dismisses a flagged line through the remove mutation", async () => {
    state.lines = [...oneLine, removedLine];
    render(<GroceryList />);
    fireEvent.click(screen.getByRole("button", { name: /dismiss kale/i }));
    await waitFor(() => expect(mutationMock).toHaveBeenCalledWith({ id: "g2" }));
  });
});

describe("GroceryList purchase units", () => {
  beforeEach(() => {
    state.lines = [
      {
        _id: "g9",
        userId: "dev-user",
        item: "Parsley",
        canonicalItem: "parsley",
        unit: "tbsp",
        quantity: 2,
        aisle: "produce",
        checked: false,
        purchase: { quantity: 1, unit: "bunch", residue: 6, residueUnit: "tbsp" },
        _creationTime: 0,
      },
    ];
  });

  it("asks for what the shop sells, not what the recipe measured", () => {
    render(<GroceryList />);
    expect(screen.getByText(/1 bunch/)).toBeTruthy();
  });

  it("keeps the recipes' measure visible beside it", () => {
    render(<GroceryList />);
    expect(screen.getByText(/needs 2 tbsp/)).toBeTruthy();
  });

  it("falls back to the recipe's own measure with no pack data", () => {
    state.lines = [{ ...state.lines[0], purchase: undefined }];
    render(<GroceryList />);
    expect(screen.getByText(/2 tbsp Parsley/)).toBeTruthy();
    expect(screen.queryByText(/needs/)).toBeNull();
  });
});

// BL-0019: the list is read one-handed in a shop, so the top of it has to stay
// "what's left" and the global controls have to be reachable with a thumb.
describe("GroceryList aisle sections", () => {
  const twoAisles = [
    {
      _id: "a",
      userId: "dev-user",
      item: "Milk",
      unit: "cup",
      quantity: 1,
      aisle: "dairy",
      checked: false,
      _creationTime: 0,
    },
    {
      _id: "b",
      userId: "dev-user",
      item: "Kale",
      unit: "bunch",
      quantity: 1,
      aisle: "produce",
      checked: false,
      _creationTime: 1,
    },
  ];

  it("counts what each aisle still has in it", () => {
    state.lines = twoAisles;
    render(<GroceryList />);
    expect(screen.getByRole("button", { name: "Dairy, 1 item to buy" })).toBeTruthy();
  });

  it("folds an aisle away, and its lines with it", () => {
    state.lines = twoAisles;
    render(<GroceryList />);
    fireEvent.click(screen.getByRole("button", { name: /^Dairy,/ }));
    expect(screen.queryByText(/Milk/)).toBeNull();
    // Only that aisle: folding dairy must not fold the rest of the shop.
    expect(screen.getByText(/Kale/)).toBeTruthy();
  });

  it("arrives unfolded — a list that hides the shopping is not a list", () => {
    state.lines = twoAisles;
    render(<GroceryList />);
    expect(screen.getByText(/Milk/)).toBeTruthy();
    expect(screen.getByText(/Kale/)).toBeTruthy();
  });
});

describe("GroceryList in-cart section", () => {
  const oneOfEach = [
    { ...oneLine[0], _id: "g1", item: "Milk", aisle: "dairy", checked: true },
    { ...oneLine[0], _id: "g2", item: "Kale", aisle: "produce", checked: false },
  ];

  function inCartSection() {
    return screen.getByRole("button", { name: /^In cart,/ }).closest("section") as HTMLElement;
  }

  it("moves what is already bought out of the aisles being walked", () => {
    state.lines = oneOfEach;
    render(<GroceryList />);
    expect(within(inCartSection()).getByText(/Milk/)).toBeTruthy();
    // Dairy had one line and it is in the cart, so the aisle is gone entirely.
    expect(screen.queryByRole("button", { name: /^Dairy,/ })).toBeNull();
  });

  it("leaves what is still to buy where it was", () => {
    state.lines = oneOfEach;
    render(<GroceryList />);
    expect(within(inCartSection()).queryByText(/Kale/)).toBeNull();
    expect(screen.getByRole("button", { name: "Produce, 1 item to buy" })).toBeTruthy();
  });

  it("says nothing at all when the cart is empty", () => {
    state.lines = [oneOfEach[1]];
    render(<GroceryList />);
    expect(screen.queryByRole("button", { name: /^In cart,/ })).toBeNull();
  });

  it("counts the cart", () => {
    state.lines = oneOfEach;
    render(<GroceryList />);
    expect(screen.getByRole("button", { name: "In cart, 1 item" })).toBeTruthy();
  });

  it("reports progress in the thumb zone", () => {
    state.lines = oneOfEach;
    render(<GroceryList />);
    expect(screen.getByText("1 of 2 in cart")).toBeTruthy();
  });

  it("holds a line just ticked in place, so it is seen leaving", () => {
    state.lines = [{ ...oneOfEach[0], checked: false }];
    const { rerender } = render(<GroceryList />);
    state.lines = [{ ...oneOfEach[0], checked: true }];
    rerender(<GroceryList />);

    // Still under its aisle rather than teleported into the cart below.
    expect(
      within(
        screen.getByRole("button", { name: /^Dairy,/ }).closest("section") as HTMLElement,
      ).getByText(/Milk/),
    ).toBeTruthy();
  });

  it("lands it in the cart once the animation is done", () => {
    vi.useFakeTimers();
    try {
      state.lines = [{ ...oneOfEach[0], checked: false }];
      const { rerender } = render(<GroceryList />);
      state.lines = [{ ...oneOfEach[0], checked: true }];
      rerender(<GroceryList />);

      act(() => {
        vi.advanceTimersByTime(400);
      });

      expect(within(inCartSection()).getByText(/Milk/)).toBeTruthy();
      expect(screen.queryByRole("button", { name: /^Dairy,/ })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not animate a list that arrives already half-shopped", () => {
    state.lines = oneOfEach;
    render(<GroceryList />);
    // No transition to run: the first list we are handed is not a list of
    // things that just happened.
    expect(within(inCartSection()).getByText(/Milk/)).toBeTruthy();
  });
});

describe("GroceryList done shopping", () => {
  const halfShopped = [
    { ...oneLine[0], _id: "g1", item: "Milk", checked: true },
    { ...oneLine[0], _id: "g2", item: "Kale", checked: false },
  ];

  function openSheet() {
    fireEvent.click(screen.getByRole("button", { name: "Done shopping" }));
  }

  it("closes the trip and keeps what was not bought", async () => {
    state.lines = halfShopped;
    render(<GroceryList />);
    openSheet();
    fireEvent.click(screen.getByRole("button", { name: /keep what i didn't buy/i }));

    await waitFor(() => expect(mutationMock).toHaveBeenCalledWith({ unbought: "keep" }));
  });

  it("clears the whole list when the user asks it to", async () => {
    state.lines = halfShopped;
    render(<GroceryList />);
    openSheet();
    fireEvent.click(screen.getByRole("button", { name: /clear the whole list/i }));

    await waitFor(() => expect(mutationMock).toHaveBeenCalledWith({ unbought: "remove" }));
  });

  it("backs out without touching anything", async () => {
    state.lines = halfShopped;
    render(<GroceryList />);
    openSheet();
    fireEvent.click(screen.getByRole("button", { name: /not yet/i }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mutationMock).not.toHaveBeenCalled();
  });

  it("says what is in each half before it does anything", () => {
    state.lines = halfShopped;
    render(<GroceryList />);
    openSheet();

    const sheet = screen.getByRole("dialog");
    expect(sheet.textContent).toContain("1 item is in your cart");
    expect(sheet.textContent).toContain("1 item is still unbought");
  });

  it("owns up to the leftover questions it is about to close", () => {
    state.lines = halfShopped;
    state.leftovers = [{ _id: "g1", item: "Parsley" }];
    render(<GroceryList />);
    openSheet();

    expect(screen.getByRole("dialog").textContent).toContain(
      "1 leftover question will close unanswered",
    );
  });

  it("stays quiet about leftovers when there are none", () => {
    state.lines = halfShopped;
    render(<GroceryList />);
    openSheet();

    expect(screen.getByRole("dialog").textContent).not.toContain("leftover question");
  });

  it("offers nothing to finish on an empty list", () => {
    state.lines = [];
    render(<GroceryList />);
    expect(
      (screen.getByRole("button", { name: "Done shopping" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

describe("GroceryList swipe-away and undo", () => {
  const manual = [{ ...oneLine[0], _id: "g1", item: "Foil", manual: true }];

  /** A finger landing on the row's text and dragging left past the threshold. */
  function swipeAway(label: RegExp) {
    const target = screen.getByText(label);
    fireEvent.pointerDown(target, { clientX: 300, clientY: 100 });
    fireEvent.pointerMove(target, { clientX: 180, clientY: 100 });
    fireEvent.pointerUp(target, { clientX: 180, clientY: 100 });
  }

  it("removes a manual line on a swipe", async () => {
    state.lines = manual;
    render(<GroceryList />);
    swipeAway(/Foil/);
    await waitFor(() => expect(mutationMock).toHaveBeenCalledWith({ id: "g1" }));
  });

  it("keeps the button as the primary path, so swipe is never the only way", () => {
    state.lines = manual;
    render(<GroceryList />);
    expect(screen.getByRole("button", { name: /remove foil/i })).toBeTruthy();
  });

  it("will not swipe away a generated line, which cannot be removed at all", async () => {
    state.lines = [{ ...oneLine[0], item: "Garlic" }];
    render(<GroceryList />);
    swipeAway(/Garlic/);
    // Nothing to accelerate: the row has no Remove button either.
    await waitFor(() => expect(mutationMock).not.toHaveBeenCalled());
  });

  it("offers undo after a removal", () => {
    state.lines = manual;
    render(<GroceryList />);
    fireEvent.click(screen.getByRole("button", { name: /remove foil/i }));
    expect(screen.getByText("Removed Foil")).toBeTruthy();
  });

  it("puts the line back, with its own state rather than a blank row", async () => {
    state.lines = [{ ...manual[0], quantity: 3, unit: "roll", aisle: "pantry", checked: true }];
    render(<GroceryList />);
    fireEvent.click(screen.getByRole("button", { name: /remove foil/i }));
    mutationMock.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));

    await waitFor(() =>
      expect(mutationMock).toHaveBeenCalledWith({
        line: {
          item: "Foil",
          canonicalItem: undefined,
          unit: "roll",
          quantity: 3,
          aisle: "pantry",
          checked: true,
          alreadyHave: undefined,
          shelfLifeDays: undefined,
          sources: undefined,
          purchase: undefined,
          leftoverDecision: undefined,
          manual: true,
          removed: undefined,
        },
      }),
    );
  });

  it("takes the undo offer away once it is used", async () => {
    state.lines = manual;
    render(<GroceryList />);
    fireEvent.click(screen.getByRole("button", { name: /remove foil/i }));
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));

    await waitFor(() => expect(screen.queryByText("Removed Foil")).toBeNull());
  });
});

describe("GroceryList live household sync", () => {
  const line = { ...oneLine[0], _id: "g1", item: "Milk", checked: false };

  function rowFor(text: RegExp) {
    return screen.getByText(text).closest("li") as HTMLElement;
  }

  it("flashes a line somebody else ticked off", () => {
    state.lines = [line];
    const { rerender } = render(<GroceryList />);

    state.lines = [{ ...line, checked: true }];
    rerender(<GroceryList />);

    expect(rowFor(/Milk/).className).toContain("grocery-remote");
  });

  it("does not flash the user's own tap — they know what they just did", () => {
    state.lines = [line];
    const { rerender } = render(<GroceryList />);

    fireEvent.click(screen.getByRole("checkbox"));
    state.lines = [{ ...line, checked: true }];
    rerender(<GroceryList />);

    expect(rowFor(/Milk/).className).not.toContain("grocery-remote");
  });

  it("does not flash the list it was handed on arrival", () => {
    state.lines = [{ ...line, checked: true }];
    render(<GroceryList />);
    expect(rowFor(/Milk/).className).not.toContain("grocery-remote");
  });
});
