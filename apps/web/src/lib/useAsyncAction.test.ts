import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAsyncAction, errorMessage } from "./useAsyncAction";

describe("errorMessage", () => {
  it("returns the message for an Error", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
  });
  it("stringifies a non-Error", () => {
    expect(errorMessage("nope")).toBe("nope");
  });
});

describe("useAsyncAction", () => {
  it("returns the resolved value and leaves error null on success", async () => {
    const { result } = renderHook(() => useAsyncAction());
    let returned: unknown;
    await act(async () => {
      returned = await result.current.run(() => Promise.resolve(42));
    });
    expect(returned).toBe(42);
    expect(result.current.error).toBeNull();
    expect(result.current.pending).toBe(false);
  });

  it("sets error and returns undefined on rejection", async () => {
    const { result } = renderHook(() => useAsyncAction());
    let returned: unknown = "sentinel";
    await act(async () => {
      returned = await result.current.run(() => Promise.reject(new Error("down")));
    });
    expect(returned).toBeUndefined();
    expect(result.current.error).toBe("down");
    expect(result.current.pending).toBe(false);
  });

  it("clearError resets the error", async () => {
    const { result } = renderHook(() => useAsyncAction());
    await act(async () => {
      await result.current.run(() => Promise.reject(new Error("x")));
    });
    expect(result.current.error).toBe("x");
    act(() => result.current.clearError());
    expect(result.current.error).toBeNull();
  });
});
