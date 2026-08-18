import { TEST_IDS } from "@pantry/core/testing";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { signIn } = vi.hoisted(() => ({
  signIn: vi.fn((_provider: string, _credentials: Record<string, unknown>) => Promise.resolve()),
}));
vi.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({ signIn, signOut: vi.fn() }),
}));

import { AuthForm } from "./AuthForm";

describe("AuthForm", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders email and password fields and defaults to sign in", () => {
    render(<AuthForm />);
    expect(screen.getByPlaceholderText("Email")).toBeTruthy();
    expect(screen.getByPlaceholderText("Password")).toBeTruthy();
    expect(screen.getByRole("button", { name: /sign in/i })).toBeTruthy();
  });

  // Password managers pair a credential by the `username`/`current-password`
  // autocomplete tokens, and key the saved entry on the field's id/name — so
  // these attributes are load-bearing, not decoration.
  it("labels the fields so a password manager can autofill them", () => {
    render(<AuthForm />);
    const email = screen.getByPlaceholderText("Email");
    const password = screen.getByPlaceholderText("Password");

    expect(email.getAttribute("autocomplete")).toBe("username");
    expect(email.getAttribute("id")).toBe("email");
    expect(email.getAttribute("name")).toBe("email");
    expect(screen.getByLabelText("Email")).toBe(email);

    expect(password.getAttribute("autocomplete")).toBe("current-password");
    expect(password.getAttribute("id")).toBe("password");
    expect(password.getAttribute("name")).toBe("password");
    expect(screen.getByLabelText("Password")).toBe(password);
  });

  it("asks for a new password on the sign-up flow", () => {
    render(<AuthForm />);
    fireEvent.click(screen.getByRole("button", { name: /need an account/i }));

    const password = screen.getByPlaceholderText("Password");
    expect(password.getAttribute("autocomplete")).toBe("new-password");
    expect(screen.getByPlaceholderText("Email").getAttribute("autocomplete")).toBe("username");
  });

  it("toggles to sign up", () => {
    render(<AuthForm />);
    fireEvent.click(screen.getByRole("button", { name: /need an account/i }));
    expect(screen.getByRole("button", { name: /sign up/i })).toBeTruthy();
  });

  it("submits credentials as a plain object, not a FormData", async () => {
    render(<AuthForm />);
    fireEvent.change(screen.getByPlaceholderText("Email"), { target: { value: "a@b.com" } });
    fireEvent.change(screen.getByPlaceholderText("Password"), { target: { value: "hunter2" } });
    fireEvent.submit(screen.getByTestId(TEST_IDS.auth.form));

    expect(signIn).toHaveBeenCalledTimes(1);
    expect(signIn).toHaveBeenCalledWith("password", {
      email: "a@b.com",
      password: "hunter2",
      flow: "signIn",
    });
  });

  it("submits the sign-up flow after toggling", async () => {
    render(<AuthForm />);
    fireEvent.click(screen.getByRole("button", { name: /need an account/i }));
    fireEvent.change(screen.getByPlaceholderText("Email"), { target: { value: "a@b.com" } });
    fireEvent.change(screen.getByPlaceholderText("Password"), { target: { value: "hunter2" } });
    fireEvent.submit(screen.getByTestId(TEST_IDS.auth.form));

    expect(signIn).toHaveBeenCalledWith("password", {
      email: "a@b.com",
      password: "hunter2",
      flow: "signUp",
    });
  });
});
