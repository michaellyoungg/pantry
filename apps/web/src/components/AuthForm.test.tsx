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

  it("toggles to sign up", () => {
    render(<AuthForm />);
    fireEvent.click(screen.getByRole("button", { name: /need an account/i }));
    expect(screen.getByRole("button", { name: /sign up/i })).toBeTruthy();
  });

  it("submits credentials as a plain object, not a FormData", async () => {
    render(<AuthForm />);
    fireEvent.change(screen.getByPlaceholderText("Email"), { target: { value: "a@b.com" } });
    fireEvent.change(screen.getByPlaceholderText("Password"), { target: { value: "hunter2" } });
    fireEvent.submit(screen.getByTestId("auth-form"));

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
    fireEvent.submit(screen.getByTestId("auth-form"));

    expect(signIn).toHaveBeenCalledWith("password", {
      email: "a@b.com",
      password: "hunter2",
      flow: "signUp",
    });
  });
});
