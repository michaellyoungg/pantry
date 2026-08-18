import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

// RNTL 14 made `render` and `fireEvent` async: they await React 19's `act`
// internally, and `screen` is only bound once that settles.

// `jest.mock` is hoisted above this file's imports, so the factory may only
// close over names prefixed `mock`.
const mockState = {
  prefs: { cuisines: [] } as { cuisines?: string[]; maxMinutes?: number } | undefined,
};
const mockSave = jest.fn(() => Promise.resolve());

jest.mock("convex/react", () => ({
  useQuery: () => mockState.prefs,
  useMutation: () => mockSave,
}));

import { TastePreferences } from "./TastePreferences";

beforeEach(() => {
  jest.clearAllMocks();
  mockSave.mockImplementation(() => Promise.resolve());
  mockState.prefs = { cuisines: [] };
});

describe("TastePreferences", () => {
  it("shows stored cuisines as labels rather than slugs", async () => {
    mockState.prefs = { cuisines: ["south-indian"] };

    await render(<TastePreferences />);

    expect(screen.getByTestId("settings.cuisine.south-indian")).toHaveTextContent(/South Indian/);
  });

  // Stored raw, "South Indian" would be compared to the recipe's "south-indian"
  // and match nothing.
  it("stores a typed cuisine as the slug a recipe carries", async () => {
    await render(<TastePreferences />);

    await fireEvent.changeText(screen.getByTestId("settings.cuisine-input"), "South Indian");
    await fireEvent.press(screen.getByTestId("settings.cuisine-add"));

    await waitFor(() => expect(mockSave).toHaveBeenCalledWith({ cuisines: ["south-indian"] }));
  });

  it("keeps the cuisines already stored when adding another", async () => {
    mockState.prefs = { cuisines: ["thai"] };
    await render(<TastePreferences />);

    await fireEvent.changeText(screen.getByTestId("settings.cuisine-input"), "italian");
    await fireEvent(screen.getByTestId("settings.cuisine-input"), "submitEditing");

    await waitFor(() => expect(mockSave).toHaveBeenCalledWith({ cuisines: ["thai", "italian"] }));
  });

  it("removes a cuisine", async () => {
    mockState.prefs = { cuisines: ["thai", "italian"] };
    await render(<TastePreferences />);

    await fireEvent.press(screen.getByTestId("settings.cuisine-remove.thai"));

    await waitFor(() => expect(mockSave).toHaveBeenCalledWith({ cuisines: ["italian"] }));
  });

  it("marks the stored cook-time limit as the chosen one", async () => {
    mockState.prefs = { cuisines: [], maxMinutes: 30 };

    await render(<TastePreferences />);

    expect(
      screen.getByTestId("settings.time-limit.under-30-min").props.accessibilityState.selected,
    ).toBe(true);
    expect(
      screen.getByTestId("settings.time-limit.no-preference").props.accessibilityState.selected,
    ).toBe(false);
  });

  it("saves a chosen cook-time limit", async () => {
    await render(<TastePreferences />);

    await fireEvent.press(screen.getByTestId("settings.time-limit.under-30-min"));

    await waitFor(() => expect(mockSave).toHaveBeenCalledWith({ maxMinutes: 30 }));
  });

  // 0 is the wire value for "no opinion" — the one way to unset an optional
  // preference that otherwise merges on omission.
  it("clears the limit when the cook stops caring", async () => {
    mockState.prefs = { cuisines: [], maxMinutes: 30 };
    await render(<TastePreferences />);

    await fireEvent.press(screen.getByTestId("settings.time-limit.no-preference"));

    await waitFor(() => expect(mockSave).toHaveBeenCalledWith({ maxMinutes: 0 }));
  });

  // Writing against the empty fallback would erase a taste the screen has not
  // seen yet.
  it("offers no controls while the stored tastes are still loading", async () => {
    mockState.prefs = undefined;

    await render(<TastePreferences />);

    expect(screen.getByTestId("settings.tastes-loading")).toBeOnTheScreen();
    expect(screen.queryByTestId("settings.cuisine-input")).toBeNull();
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("ignores an entry with nothing usable in it, and still clears the field", async () => {
    await render(<TastePreferences />);

    await fireEvent.changeText(screen.getByTestId("settings.cuisine-input"), "  !! ");
    await fireEvent.press(screen.getByTestId("settings.cuisine-add"));

    expect(screen.getByTestId("settings.cuisine-input").props.value).toBe("");
    expect(mockSave).not.toHaveBeenCalled();
  });

  // The whole point of the section sitting under the avoid list: one removes
  // recipes, this one only reorders them.
  it("says that a taste ranks recipes rather than removing them", async () => {
    await render(<TastePreferences />);

    expect(screen.getByTestId("settings.section.tastes")).toHaveTextContent(/nothing is removed/i);
  });
});
