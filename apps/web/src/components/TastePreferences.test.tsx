import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { state, setMock } = vi.hoisted(() => ({
  state: {
    prefs: undefined as { cuisines?: string[]; maxMinutes?: number } | undefined,
  },
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
  api: { preferences: { get: "preferences:get", set: "preferences:set" } },
}));

import { TastePreferences } from "./TastePreferences";

beforeEach(() => {
  vi.clearAllMocks();
  state.prefs = { cuisines: [], maxMinutes: undefined };
});
afterEach(() => vi.restoreAllMocks());

describe("TastePreferences", () => {
  it("shows the cuisines already stored, as labels rather than slugs", () => {
    state.prefs = { cuisines: ["south-indian"] };
    render(<TastePreferences />);
    expect(screen.getByText("South Indian")).toBeTruthy();
  });

  // The whole reason slugifying happens client-side: stored raw, "South Indian"
  // would be compared to the recipe's "south-indian" and match nothing.
  it("stores a typed cuisine as the slug a recipe carries", async () => {
    render(<TastePreferences />);
    fireEvent.change(screen.getByLabelText(/cuisine you like/i), {
      target: { value: "South Indian" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
    await waitFor(() => expect(setMock).toHaveBeenCalledWith({ cuisines: ["south-indian"] }));
  });

  it("keeps the cuisines already stored when adding another", async () => {
    state.prefs = { cuisines: ["thai"] };
    render(<TastePreferences />);
    fireEvent.change(screen.getByLabelText(/cuisine you like/i), { target: { value: "italian" } });
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
    await waitFor(() => expect(setMock).toHaveBeenCalledWith({ cuisines: ["thai", "italian"] }));
  });

  // Re-adding one costs no round trip at all now that the write lives in
  // `useTastePreferences` — the list it would send is the list already stored.
  it("does not store the same cuisine twice", async () => {
    state.prefs = { cuisines: ["thai"] };
    render(<TastePreferences />);
    fireEvent.change(screen.getByLabelText(/cuisine you like/i), { target: { value: "Thai" } });
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
    await waitFor(() => expect(setMock).not.toHaveBeenCalled());
  });

  it("removes a cuisine", async () => {
    state.prefs = { cuisines: ["thai", "italian"] };
    render(<TastePreferences />);
    fireEvent.click(screen.getByRole("button", { name: /remove thai/i }));
    await waitFor(() => expect(setMock).toHaveBeenCalledWith({ cuisines: ["italian"] }));
  });

  it("shows the stored cook-time limit", () => {
    state.prefs = { cuisines: [], maxMinutes: 30 };
    render(<TastePreferences />);
    expect((screen.getByLabelText(/most time/i) as HTMLSelectElement).value).toBe("30");
  });

  it("saves a chosen cook-time limit", async () => {
    render(<TastePreferences />);
    fireEvent.change(screen.getByLabelText(/most time/i), { target: { value: "30" } });
    await waitFor(() => expect(setMock).toHaveBeenCalledWith({ maxMinutes: 30 }));
  });

  // 0 is the wire value for "no opinion" — the one way to unset an optional
  // preference that otherwise merges on omission.
  it("clears the limit when the cook stops caring", async () => {
    state.prefs = { cuisines: [], maxMinutes: 30 };
    render(<TastePreferences />);
    fireEvent.change(screen.getByLabelText(/most time/i), { target: { value: "0" } });
    await waitFor(() => expect(setMock).toHaveBeenCalledWith({ maxMinutes: 0 }));
  });

  // Writing against the `[]` fallback before the query resolves would erase a
  // stored taste the component has not seen yet.
  it("writes nothing while the stored preferences are still loading", () => {
    state.prefs = undefined;
    render(<TastePreferences />);
    expect(screen.queryByLabelText(/cuisine you like/i)).toBeNull();
    expect(setMock).not.toHaveBeenCalled();
  });

  it("ignores an entry with nothing usable in it", async () => {
    render(<TastePreferences />);
    fireEvent.change(screen.getByLabelText(/cuisine you like/i), { target: { value: "  !! " } });
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
    await waitFor(() => expect(setMock).not.toHaveBeenCalled());
  });
});
