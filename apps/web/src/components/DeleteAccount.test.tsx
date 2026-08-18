import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  deleteAccount: vi.fn(async () => null as unknown),
  signOut: vi.fn(async () => undefined),
}));

// The component drives the real `useDeleteAccount` hook, so only the Convex
// action underneath it is stubbed — the confirmation gate under test is the
// shipped one, not a re-implementation.
vi.mock("convex/react", () => ({ useAction: () => state.deleteAccount }));
vi.mock("@convex-dev/auth/react", () => ({ useAuthActions: () => ({ signOut: state.signOut }) }));

const { DeleteAccount } = await import("./DeleteAccount");

/** Reveal the confirmation field — deletion is never one tap. */
function arm() {
  fireEvent.click(screen.getByRole("button", { name: /delete my account/i }));
}

function type(text: string) {
  fireEvent.change(screen.getByLabelText(/type delete to confirm/i), { target: { value: text } });
}

const confirmButton = () => screen.getByRole("button", { name: /^delete account$/i });

beforeEach(() => {
  vi.clearAllMocks();
  state.deleteAccount.mockImplementation(async () => null);
});

describe("DeleteAccount", () => {
  it("does not offer the confirm button until the user asks to delete", () => {
    render(<DeleteAccount />);
    expect(screen.queryByLabelText(/type delete to confirm/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /^delete account$/i })).toBeNull();
  });

  it("keeps the confirm button disabled until the word is typed exactly", () => {
    render(<DeleteAccount />);
    arm();
    expect((confirmButton() as HTMLButtonElement).disabled).toBe(true);

    type("delete");
    expect((confirmButton() as HTMLButtonElement).disabled).toBe(true);

    type("DELETE");
    expect((confirmButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it("deletes and then signs out", async () => {
    render(<DeleteAccount />);
    arm();
    type("DELETE");
    fireEvent.click(confirmButton());

    await waitFor(() =>
      expect(state.deleteAccount).toHaveBeenCalledWith({ confirmation: "DELETE" }),
    );
    await waitFor(() => expect(state.signOut).toHaveBeenCalledTimes(1));
  });

  // A failed cascade leaves the account intact, so the user must be told and
  // left signed in — not dropped at a login screen for an account that exists.
  it("reports a failure and stays signed in", async () => {
    state.deleteAccount.mockImplementation(async () => {
      throw new Error("recipe-service is down");
    });
    render(<DeleteAccount />);
    arm();
    type("DELETE");
    fireEvent.click(confirmButton());

    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/down/));
    expect(state.signOut).not.toHaveBeenCalled();
  });

  it("cancelling puts the confirmation away and forgets what was typed", () => {
    render(<DeleteAccount />);
    arm();
    type("DELETE");
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(screen.queryByLabelText(/type delete to confirm/i)).toBeNull();
    arm();
    expect((screen.getByLabelText(/type delete to confirm/i) as HTMLInputElement).value).toBe("");
    expect((confirmButton() as HTMLButtonElement).disabled).toBe(true);
  });
});
