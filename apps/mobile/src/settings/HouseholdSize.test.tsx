import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

// RNTL 14 made `render` and `fireEvent` async: they await React 19's `act`
// internally, and `screen` is only bound once that settles. Dropping an `await`
// does not fail loudly — the next line throws ``render` function has not been
// called``, which reads like the component never mounted.

// `jest.mock` is hoisted above this file's imports, so the factory may only
// close over names prefixed `mock`.
const mockState = { prefs: { householdSize: undefined } as Record<string, unknown> | undefined };
const mockSave = jest.fn(() => Promise.resolve());

// The screen drives the real `useHouseholdSize`, so only the Convex calls under
// it are stubbed — the whole-number rule under test is the shipped one.
jest.mock("convex/react", () => ({
  useQuery: () => mockState.prefs,
  useMutation: () => mockSave,
}));

import { HouseholdSize } from "./HouseholdSize";

beforeEach(() => {
  jest.clearAllMocks();
  mockSave.mockImplementation(() => Promise.resolve());
  mockState.prefs = { householdSize: undefined };
});

describe("HouseholdSize", () => {
  it("shows the stored size", async () => {
    mockState.prefs = { householdSize: 4 };

    await render(<HouseholdSize />);

    expect(screen.getByTestId("settings.household-input").props.value).toBe("4");
  });

  // An empty box before the query lands reads as "you have not set this", which
  // is one keystroke away from overwriting a real answer.
  it("waits for the stored size rather than showing an empty field", async () => {
    mockState.prefs = undefined;

    await render(<HouseholdSize />);

    expect(screen.getByTestId("settings.household-loading")).toBeOnTheScreen();
    expect(screen.queryByTestId("settings.household-input")).toBeNull();
  });

  it("saves the number the user typed", async () => {
    await render(<HouseholdSize />);

    await fireEvent.changeText(screen.getByTestId("settings.household-input"), "3");
    await fireEvent.press(screen.getByTestId("settings.household-save"));

    await waitFor(() => expect(mockSave).toHaveBeenCalledWith({ householdSize: 3 }));
  });

  // Blank is a real answer: it puts every recipe back on a single batch.
  it("clears the preference when the field is emptied", async () => {
    mockState.prefs = { householdSize: 4 };
    await render(<HouseholdSize />);

    await fireEvent.changeText(screen.getByTestId("settings.household-input"), "");
    await fireEvent.press(screen.getByTestId("settings.household-save"));

    await waitFor(() => expect(mockSave).toHaveBeenCalledWith({}));
  });

  it("refuses a fraction of a person rather than scaling every quantity by it", async () => {
    await render(<HouseholdSize />);

    await fireEvent.changeText(screen.getByTestId("settings.household-input"), "2.5");
    await fireEvent.press(screen.getByTestId("settings.household-save"));

    await waitFor(() => expect(screen.getByTestId("settings.household-invalid")).toBeOnTheScreen());
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("reports the server's refusal", async () => {
    mockSave.mockImplementation(() =>
      Promise.reject(new Error("householdSize must be at most 20")),
    );
    await render(<HouseholdSize />);

    await fireEvent.changeText(screen.getByTestId("settings.household-input"), "40");
    await fireEvent.press(screen.getByTestId("settings.household-save"));

    await waitFor(() =>
      expect(screen.getByTestId("settings.household-error")).toHaveTextContent(/at most 20/),
    );
  });
});
