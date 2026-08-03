import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { state, setMock } = vi.hoisted(() => ({
  state: { prefs: undefined as { householdSize?: number } | undefined },
  setMock: vi.fn(() => Promise.resolve()),
}));

vi.mock("convex/react", () => ({
  useQuery: () => state.prefs,
  useMutation: () => {
    const fn = ((...args: unknown[]) =>
      (setMock as (...a: unknown[]) => Promise<unknown>)(...args)) as unknown as {
      (...a: unknown[]): Promise<unknown>;
      withOptimisticUpdate: (u: unknown) => typeof fn;
    };
    fn.withOptimisticUpdate = () => fn;
    return fn;
  },
}));

vi.mock("@pantry/convex/api", () => ({
  api: {
    preferences: { get: "preferences:get", setHouseholdSize: "preferences:setHouseholdSize" },
  },
}));

import { HouseholdSize } from "./HouseholdSize";

beforeEach(() => {
  vi.clearAllMocks();
  state.prefs = { householdSize: undefined };
});
afterEach(() => vi.restoreAllMocks());

describe("HouseholdSize", () => {
  it("shows the stored size", () => {
    state.prefs = { householdSize: 4 };
    render(<HouseholdSize />);
    expect((screen.getByLabelText(/people/i) as HTMLInputElement).value).toBe("4");
  });

  it("saves the number the user typed", async () => {
    render(<HouseholdSize />);
    fireEvent.change(screen.getByLabelText(/people/i), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(setMock).toHaveBeenCalledWith({ householdSize: 3 }));
  });

  it("clears the preference when the field is emptied", async () => {
    state.prefs = { householdSize: 4 };
    render(<HouseholdSize />);
    fireEvent.change(screen.getByLabelText(/people/i), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(setMock).toHaveBeenCalledWith({}));
  });

  it("does not send a size that isn't a whole number of people", async () => {
    render(<HouseholdSize />);
    fireEvent.change(screen.getByLabelText(/people/i), { target: { value: "2.5" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(setMock).not.toHaveBeenCalled();
  });

  it("waits for the query rather than showing an empty field as 'unset'", () => {
    state.prefs = undefined;
    render(<HouseholdSize />);
    expect(screen.queryByLabelText(/people/i)).toBeNull();
  });
});
