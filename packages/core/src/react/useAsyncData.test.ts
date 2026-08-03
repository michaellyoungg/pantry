// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useAsyncData } from "./useAsyncData";

describe("useAsyncData", () => {
  it("starts loading, then exposes resolved data", async () => {
    const fn = vi.fn(() => Promise.resolve([1, 2]));
    const { result } = renderHook(() => useAsyncData(fn));
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeUndefined();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual([1, 2]);
    expect(result.current.error).toBeNull();
  });

  it("captures a rejection as an error and leaves data undefined", async () => {
    const fn = vi.fn(() => Promise.reject(new Error("down")));
    const { result } = renderHook(() => useAsyncData(fn));
    await waitFor(() => expect(result.current.error).toBe("down"));
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeUndefined();
  });

  it("reload re-runs fn (error then success)", async () => {
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValueOnce("ok");
    const { result } = renderHook(() => useAsyncData(fn));
    await waitFor(() => expect(result.current.error).toBe("down"));
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.data).toBe("ok"));
    expect(result.current.error).toBeNull();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("re-runs when a dep changes", async () => {
    const fn = vi.fn(() => Promise.resolve("x"));
    const { rerender } = renderHook(({ k }) => useAsyncData(fn, [k]), {
      initialProps: { k: 0 },
    });
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(1));
    rerender({ k: 1 });
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(2));
  });
});
