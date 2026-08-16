import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

// `jest.mock` is hoisted above this file's imports, so the factory may only
// close over names prefixed `mock`.
const mockSignIn = jest.fn(() => Promise.resolve());
jest.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({ signIn: mockSignIn, signOut: jest.fn() }),
}));

import { AuthForm } from "./AuthForm";

// RNTL 14 made `render` and `fireEvent` async: they await React 19's `act`
// internally, and `screen` is only bound once that settles. Dropping an `await`
// does not fail loudly — the next line throws ``render` function has not been
// called``, which reads like the component never mounted.
describe("AuthForm", () => {
  beforeEach(() => mockSignIn.mockClear());

  it("defaults to sign in", async () => {
    await render(<AuthForm />);

    expect(screen.getByTestId("auth.title")).toHaveTextContent("Sign in");
  });

  it("submits credentials as a plain object, the shape web already sends", async () => {
    await render(<AuthForm />);

    await fireEvent.changeText(screen.getByTestId("auth.email"), "a@b.com");
    await fireEvent.changeText(screen.getByTestId("auth.password"), "hunter2");
    await fireEvent.press(screen.getByTestId("auth.submit"));

    await waitFor(() =>
      expect(mockSignIn).toHaveBeenCalledWith("password", {
        email: "a@b.com",
        password: "hunter2",
        flow: "signIn",
      }),
    );
  });

  it("switches to the sign-up flow", async () => {
    await render(<AuthForm />);

    await fireEvent.press(screen.getByTestId("auth.toggle-flow"));
    await fireEvent.changeText(screen.getByTestId("auth.email"), "a@b.com");
    await fireEvent.changeText(screen.getByTestId("auth.password"), "hunter2");
    await fireEvent.press(screen.getByTestId("auth.submit"));

    await waitFor(() =>
      expect(mockSignIn).toHaveBeenCalledWith(
        "password",
        expect.objectContaining({ flow: "signUp" }),
      ),
    );
  });

  it("tags the fields so a native password manager will fill and save them", async () => {
    // iOS reads textContentType, Android reads autoComplete. Losing either
    // silently disables autofill, which is invisible in a screenshot.
    await render(<AuthForm />);

    expect(screen.getByTestId("auth.email").props.textContentType).toBe("username");
    expect(screen.getByTestId("auth.email").props.autoComplete).toBe("email");
    expect(screen.getByTestId("auth.password").props.textContentType).toBe("password");
    expect(screen.getByTestId("auth.password").props.autoComplete).toBe("current-password");
  });

  it("asks for a new password on the sign-up flow", async () => {
    await render(<AuthForm />);

    await fireEvent.press(screen.getByTestId("auth.toggle-flow"));

    expect(screen.getByTestId("auth.password").props.textContentType).toBe("newPassword");
    expect(screen.getByTestId("auth.password").props.autoComplete).toBe("new-password");
  });

  it("surfaces a failed sign-in rather than swallowing it", async () => {
    mockSignIn.mockRejectedValueOnce(new Error("InvalidAccountId"));
    await render(<AuthForm />);

    await fireEvent.press(screen.getByTestId("auth.submit"));

    expect(await screen.findByTestId("auth.error")).toHaveTextContent("InvalidAccountId");
  });
});
