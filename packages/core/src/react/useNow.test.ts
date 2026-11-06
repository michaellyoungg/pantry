// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNow } from "./useNow";

describe("useNow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-05T23:59:30Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("holds the time steady across renders that fall between ticks", () => {
    const { result, rerender } = renderHook(() => useNow(60_000));
    const first = result.current;
    vi.setSystemTime(first + 10_000);
    rerender();
    expect(result.current).toBe(first);
  });

  it("advances on each tick, so a screen left open crosses midnight", () => {
    const { result } = renderHook(() => useNow(60_000));
    const first = result.current;
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current).toBe(first + 60_000);
  });

  it("stops ticking on unmount", () => {
    const { unmount } = renderHook(() => useNow(60_000));
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
