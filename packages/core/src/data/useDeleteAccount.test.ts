// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { actionMock } = vi.hoisted(() => ({
  actionMock: vi.fn(() => Promise.resolve(null)),
}));

vi.mock("convex/react", () => ({
  useAction: () => actionMock,
}));

import { useDeleteAccount } from "./useDeleteAccount";

beforeEach(() => {
  actionMock.mockClear();
  actionMock.mockImplementation(() => Promise.resolve(null));
});
afterEach(() => vi.restoreAllMocks());

describe("useDeleteAccount", () => {
  it("will not delete until the phrase is typed exactly", () => {
    const { result } = renderHook(() => useDeleteAccount());

    for (const near of ["", "delete", "DELETE ", "DELET"]) {
      act(() => result.current.setTyped(near));
      expect(result.current.confirmed).toBe(false);
      act(() => result.current.deleteAccount());
    }

    expect(actionMock).not.toHaveBeenCalled();
  });

  it("deletes once the phrase matches, sending it to the server too", async () => {
    const { result } = renderHook(() => useDeleteAccount());

    act(() => result.current.setTyped(result.current.phrase));
    expect(result.current.confirmed).toBe(true);
    act(() => result.current.deleteAccount());

    await waitFor(() => expect(actionMock).toHaveBeenCalledWith({ confirmation: "DELETE" }));
  });

  it("signs the client out only after the server has confirmed", async () => {
    let resolveDelete = (): void => {};
    actionMock.mockImplementation(
      () =>
        new Promise<null>((resolve) => {
          resolveDelete = () => resolve(null);
        }),
    );
    const onDeleted = vi.fn();
    const { result } = renderHook(() => useDeleteAccount({ onDeleted }));

    act(() => result.current.setTyped("DELETE"));
    act(() => result.current.deleteAccount());

    await waitFor(() => expect(result.current.pending).toBe(true));
    expect(onDeleted).not.toHaveBeenCalled();

    await act(async () => {
      resolveDelete();
    });
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
    expect(result.current.pending).toBe(false);
  });

  // A failed cascade leaves the account intact, so the user has to be told and
  // left able to try again — not signed out of an account that still exists.
  it("reports a failure and keeps the client signed in", async () => {
    actionMock.mockImplementation(() => Promise.reject(new Error("recipe-service is down")));
    const onDeleted = vi.fn();
    const { result } = renderHook(() => useDeleteAccount({ onDeleted }));

    act(() => result.current.setTyped("DELETE"));
    act(() => result.current.deleteAccount());

    await waitFor(() => expect(result.current.error).toBe("recipe-service is down"));
    expect(onDeleted).not.toHaveBeenCalled();
    expect(result.current.confirmed).toBe(true);
  });
});
