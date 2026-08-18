import { fireEvent, render, screen } from "@testing-library/react-native";

// `jest.mock` is hoisted above this file's imports, so the factory may only
// close over names prefixed `mock`.
const mockDeleteAccount = jest.fn(() => Promise.resolve(null));
const mockSignOut = jest.fn(() => Promise.resolve());

// The screen drives the real `useDeleteAccount`, so only the Convex action
// under it is stubbed — the confirmation gate under test is the shipped one.
jest.mock("convex/react", () => ({ useAction: () => mockDeleteAccount }));
jest.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({ signOut: mockSignOut }),
}));

import { DeleteAccount } from "./DeleteAccount";

async function arm() {
  await fireEvent.press(screen.getByTestId("settings.delete-account"));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDeleteAccount.mockImplementation(() => Promise.resolve(null));
});

describe("DeleteAccount", () => {
  it("shows only the entry point until the user asks to delete", async () => {
    await render(<DeleteAccount />);

    expect(screen.getByTestId("settings.delete-account")).toBeTruthy();
    expect(screen.queryByTestId("settings.delete-confirm")).toBeNull();
  });

  it("keeps the confirm button disabled until the word is typed exactly", async () => {
    await render(<DeleteAccount />);
    await arm();
    const input = screen.getByTestId("settings.delete-confirm-input");

    expect(screen.getByTestId("settings.delete-confirm").props.accessibilityState.disabled).toBe(
      true,
    );

    await fireEvent.changeText(input, "delete");
    expect(screen.getByTestId("settings.delete-confirm").props.accessibilityState.disabled).toBe(
      true,
    );

    await fireEvent.changeText(input, "DELETE");
    expect(screen.getByTestId("settings.delete-confirm").props.accessibilityState.disabled).toBe(
      false,
    );
  });

  it("deletes and then signs out", async () => {
    await render(<DeleteAccount />);
    await arm();
    await fireEvent.changeText(screen.getByTestId("settings.delete-confirm-input"), "DELETE");
    await fireEvent.press(screen.getByTestId("settings.delete-confirm"));

    expect(mockDeleteAccount).toHaveBeenCalledWith({ confirmation: "DELETE" });
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  // A failed cascade leaves the account intact, so the user must be told and
  // left signed in — not dropped at a login screen for an account that exists.
  it("reports a failure and stays signed in", async () => {
    mockDeleteAccount.mockImplementation(() => Promise.reject(new Error("recipe-service is down")));
    await render(<DeleteAccount />);
    await arm();
    await fireEvent.changeText(screen.getByTestId("settings.delete-confirm-input"), "DELETE");
    await fireEvent.press(screen.getByTestId("settings.delete-confirm"));

    expect(screen.getByTestId("settings.delete-error").children.join("")).toMatch(/down/);
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it("cancelling puts the confirmation away and forgets what was typed", async () => {
    await render(<DeleteAccount />);
    await arm();
    await fireEvent.changeText(screen.getByTestId("settings.delete-confirm-input"), "DELETE");
    await fireEvent.press(screen.getByTestId("settings.delete-cancel"));

    expect(screen.queryByTestId("settings.delete-confirm-input")).toBeNull();
    await arm();
    expect(screen.getByTestId("settings.delete-confirm-input").props.value).toBe("");
  });
});
