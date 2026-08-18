import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

// RNTL 14 made `render` and `fireEvent` async: they await React 19's `act`
// internally, and `screen` is only bound once that settles.

// `jest.mock` is hoisted above this file's imports, so the factory may only
// close over names prefixed `mock`.
const mockState = { prefs: undefined as Record<string, unknown> | undefined };
const mockAdd = jest.fn(() => Promise.resolve([] as unknown[]));
const mockRemove = jest.fn(() => Promise.resolve());

// Adding is an action and removing a mutation, which is the split that lets an
// entry come off the list while recipe-service is down — so the two are stubbed
// separately rather than through one spy.
jest.mock("convex/react", () => ({
  useQuery: () => mockState.prefs,
  useAction: () => mockAdd,
  useMutation: () => mockRemove,
}));

import { AvoidList } from "./AvoidList";

beforeEach(() => {
  jest.clearAllMocks();
  mockAdd.mockImplementation(() => Promise.resolve([]));
  mockRemove.mockImplementation(() => Promise.resolve());
  mockState.prefs = { avoidItems: [], avoidResolutions: [] };
});

describe("AvoidList", () => {
  it("shows a stored entry by its resolved display name", async () => {
    mockState.prefs = {
      avoidItems: ["peanut"],
      avoidResolutions: [
        {
          canonicalItem: "peanut",
          input: "peanuts",
          display: "Peanuts",
          kind: "allergen",
          members: ["Peanut butter", "Peanuts"],
        },
      ],
    };

    await render(<AvoidList />);

    expect(screen.getByTestId("settings.avoid-item.peanut")).toHaveTextContent(/Peanuts/);
    expect(screen.getByTestId("settings.avoid-item.peanut")).toHaveTextContent(/allergen group/);
  });

  // Web hides the members behind a tooltip. A phone has no hover, and what a
  // family entry additionally removes is not something to withhold.
  it("prints what an allergen family also removes, since there is nowhere to hover", async () => {
    mockState.prefs = {
      avoidItems: ["peanut"],
      avoidResolutions: [
        {
          canonicalItem: "peanut",
          input: "peanuts",
          display: "Peanuts",
          kind: "allergen",
          members: ["Peanut butter", "Satay sauce"],
        },
      ],
    };

    await render(<AvoidList />);

    expect(screen.getByTestId("settings.avoid-members.peanut")).toHaveTextContent(
      /Peanut butter, Satay sauce/,
    );
  });

  it("sends what was typed to be canonicalized rather than storing it raw", async () => {
    await render(<AvoidList />);

    await fireEvent.changeText(screen.getByTestId("settings.avoid-input"), "Scallion");
    await fireEvent.press(screen.getByTestId("settings.avoid-add"));

    await waitFor(() => expect(mockAdd).toHaveBeenCalledWith({ entries: ["Scallion"] }));
  });

  it("removes an entry by its canonical key", async () => {
    mockState.prefs = { avoidItems: ["peanut"], avoidResolutions: [] };
    await render(<AvoidList />);

    await fireEvent.press(screen.getByTestId("settings.avoid-remove.peanut"));

    await waitFor(() => expect(mockRemove).toHaveBeenCalledWith({ canonicalItem: "peanut" }));
  });

  it("sends a diet's seed list through the same resolver", async () => {
    await render(<AvoidList />);

    await fireEvent.press(screen.getByTestId("settings.diet.vegetarian"));

    await waitFor(() =>
      expect(mockAdd).toHaveBeenCalledWith({
        entries: expect.arrayContaining(["ground beef", "chicken"]),
      }),
    );
  });

  // The failure that matters: this list REMOVES recipes, so an entry that
  // matched nothing has to say so rather than sitting there looking like a
  // filter.
  it("says when an entry matched nothing", async () => {
    mockAdd.mockImplementation(() =>
      Promise.resolve([
        {
          input: "unobtainium",
          canonicalItem: "unobtainium",
          display: "unobtainium",
          kind: "unknown",
        },
      ]),
    );
    await render(<AvoidList />);

    await fireEvent.changeText(screen.getByTestId("settings.avoid-input"), "unobtainium");
    await fireEvent.press(screen.getByTestId("settings.avoid-add"));

    await waitFor(() =>
      expect(screen.getByTestId("settings.avoid-note.unobtainium")).toHaveTextContent(
        /doesn’t match any ingredient we know/i,
      ),
    );
  });

  it("reports what the dictionary renamed an entry to", async () => {
    mockAdd.mockImplementation(() =>
      Promise.resolve([
        { input: "Scallion", canonicalItem: "green onion", display: "Green onion", kind: "item" },
      ]),
    );
    await render(<AvoidList />);

    await fireEvent.changeText(screen.getByTestId("settings.avoid-input"), "Scallion");
    await fireEvent.press(screen.getByTestId("settings.avoid-add"));

    await waitFor(() =>
      expect(screen.getByTestId("settings.avoid-note.green-onion")).toHaveTextContent(
        /you typed “Scallion”/,
      ),
    );
  });

  it("offers the whole family when a single member was added", async () => {
    mockAdd.mockImplementation(() =>
      Promise.resolve([
        {
          input: "cheddar cheese",
          canonicalItem: "cheddar cheese",
          display: "Cheddar cheese",
          kind: "item",
          families: ["dairy"],
        },
      ]),
    );
    await render(<AvoidList />);

    await fireEvent.changeText(screen.getByTestId("settings.avoid-input"), "cheddar cheese");
    await fireEvent.press(screen.getByTestId("settings.avoid-add"));
    await waitFor(() =>
      expect(screen.getByTestId("settings.avoid-family.dairy")).toBeOnTheScreen(),
    );

    await fireEvent.press(screen.getByTestId("settings.avoid-family.dairy"));

    await waitFor(() => expect(mockAdd).toHaveBeenCalledWith({ entries: ["dairy"] }));
  });

  it("stays quiet about an entry that resolved to exactly what was typed", async () => {
    mockAdd.mockImplementation(() =>
      Promise.resolve([{ input: "Milk", canonicalItem: "milk", display: "Milk", kind: "item" }]),
    );
    await render(<AvoidList />);

    await fireEvent.changeText(screen.getByTestId("settings.avoid-input"), "Milk");
    await fireEvent.press(screen.getByTestId("settings.avoid-add"));

    await waitFor(() => expect(mockAdd).toHaveBeenCalled());
    expect(screen.queryByTestId("settings.avoid-notes")).toBeNull();
  });

  it("reports a failed add, since nothing was stored", async () => {
    mockAdd.mockImplementation(() => Promise.reject(new Error("dictionary unreachable")));
    await render(<AvoidList />);

    await fireEvent.changeText(screen.getByTestId("settings.avoid-input"), "peanut");
    await fireEvent.press(screen.getByTestId("settings.avoid-add"));

    await waitFor(() =>
      expect(screen.getByTestId("settings.avoid-error")).toHaveTextContent(/unreachable/),
    );
  });

  it("holds the write controls until the stored list is known", async () => {
    mockState.prefs = undefined;

    await render(<AvoidList />);

    expect(screen.getByTestId("settings.avoid-add").props.accessibilityState.disabled).toBe(true);
    expect(screen.getByTestId("settings.diet.vegan").props.accessibilityState.disabled).toBe(true);
  });

  it("says plainly that these entries remove recipes rather than rank them", async () => {
    await render(<AvoidList />);

    expect(screen.getByTestId("settings.section.ingredients-to-avoid")).toHaveTextContent(
      /removed, not just ranked lower/i,
    );
  });
});
