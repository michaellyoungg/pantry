import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const { signIn } = vi.hoisted(() => ({ signIn: vi.fn(() => Promise.resolve()) }));
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

  it("submits credentials with the password provider and current flow", async () => {
    render(<AuthForm />);
    fireEvent.change(screen.getByPlaceholderText("Email"), { target: { value: "a@b.com" } });
    fireEvent.change(screen.getByPlaceholderText("Password"), { target: { value: "hunter2" } });
    fireEvent.submit(screen.getByTestId("auth-form"));
    expect(signIn).toHaveBeenCalledTimes(1);
    const [provider, formData] = signIn.mock.calls[0];
    expect(provider).toBe("password");
    expect(formData.get("email")).toBe("a@b.com");
    expect(formData.get("password")).toBe("hunter2");
    expect(formData.get("flow")).toBe("signIn");
  });
});
