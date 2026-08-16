import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { state, heartbeatMock } = vi.hoisted(() => ({
  state: { others: 0 as number | undefined },
  heartbeatMock: vi.fn((_args: { sessionId: string }) => Promise.resolve(null)),
}));

vi.mock("convex/react", () => ({
  useQuery: () => state.others,
  useMutation: () => heartbeatMock,
}));

import { HEARTBEAT_MS, ShoppingPresence } from "./ShoppingPresence";

beforeEach(() => {
  vi.clearAllMocks();
  state.others = 0;
  heartbeatMock.mockImplementation(() => Promise.resolve(null));
});

afterEach(() => {
  vi.useRealTimers();
});

// BL-0019: the list has always been live; this is the part that says so.
describe("ShoppingPresence", () => {
  it("says nothing when nobody else is on the list", () => {
    render(<ShoppingPresence />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("announces one other shopper", () => {
    state.others = 1;
    render(<ShoppingPresence />);
    expect(screen.getByRole("status").textContent).toContain(
      "Someone else is on this list right now",
    );
  });

  it("counts more than one", () => {
    state.others = 3;
    render(<ShoppingPresence />);
    expect(screen.getByRole("status").textContent).toContain("3 others are on this list right now");
  });

  it("treats a query that has not loaded as nobody, rather than crashing", () => {
    state.others = undefined;
    render(<ShoppingPresence />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("says it is here immediately, not one interval from now", () => {
    render(<ShoppingPresence />);
    expect(heartbeatMock).toHaveBeenCalledTimes(1);
  });

  it("keeps beating while the list is open", () => {
    vi.useFakeTimers();
    render(<ShoppingPresence />);
    act(() => {
      vi.advanceTimersByTime(HEARTBEAT_MS * 2);
    });
    expect(heartbeatMock).toHaveBeenCalledTimes(3);
  });

  it("stops beating once the list is gone", () => {
    vi.useFakeTimers();
    const { unmount } = render(<ShoppingPresence />);
    unmount();
    act(() => {
      vi.advanceTimersByTime(HEARTBEAT_MS * 3);
    });
    expect(heartbeatMock).toHaveBeenCalledTimes(1);
  });

  it("beats under one id, so a long shop is one row and not one row per beat", () => {
    vi.useFakeTimers();
    render(<ShoppingPresence />);
    act(() => {
      vi.advanceTimersByTime(HEARTBEAT_MS);
    });
    const ids = heartbeatMock.mock.calls.map(([args]) => args.sessionId);
    expect(new Set(ids).size).toBe(1);
  });

  it("swallows a failed beat — the cost of missing one is a few quiet seconds", async () => {
    heartbeatMock.mockImplementation(() => Promise.reject(new Error("offline")));
    render(<ShoppingPresence />);
    await act(async () => {});
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
