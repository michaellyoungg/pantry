import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const actionMock = vi.hoisted(() => vi.fn(() => Promise.resolve("ok")));
vi.mock("convex/react", () => ({ useAction: () => actionMock }));

import { useTracedAction } from "./useTracedAction";

describe("useTracedAction (telemetry disabled → no active provider)", () => {
  it("calls the underlying action with args UNCHANGED (no traceCtx added)", async () => {
    const { result } = renderHook(() =>
      useTracedAction("recipes.create" as never, "recipes.create"),
    );
    await result.current({ title: "T", ingredients: [] } as never);
    expect(actionMock).toHaveBeenCalledWith({ title: "T", ingredients: [] });
  });

  it("returns the action's result", async () => {
    const { result } = renderHook(() => useTracedAction("recipes.list" as never, "recipes.list"));
    await expect(result.current({} as never)).resolves.toBe("ok");
  });
});
