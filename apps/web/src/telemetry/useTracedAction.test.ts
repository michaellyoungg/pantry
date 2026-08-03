import { context, trace } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { StackContextManager } from "@opentelemetry/sdk-trace-web";
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const actionMock = vi.hoisted(() => vi.fn((_args?: unknown) => Promise.resolve("ok")));
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

describe("useTracedAction (telemetry enabled → active provider)", () => {
  beforeEach(() => {
    actionMock.mockClear();
    // A real provider makes the hook's tracer.startSpan() yield a recording span.
    // A context manager is required too, or context.with() is a no-op and the
    // span never becomes active — so currentTraceparent() would see nothing.
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(new InMemorySpanExporter())],
    });
    trace.setGlobalTracerProvider(provider);
    context.setGlobalContextManager(new StackContextManager().enable());
  });

  afterEach(() => {
    trace.disable(); // reset the globals so other tests see a no-op tracer
    context.disable();
  });

  it("injects this span's W3C traceparent as traceCtx alongside the original args", async () => {
    const { result } = renderHook(() =>
      useTracedAction("recipes.create" as never, "recipes.create"),
    );
    await result.current({ title: "T", ingredients: [] } as never);
    expect(actionMock).toHaveBeenCalledTimes(1);
    const arg = actionMock.mock.calls[0][0] as { title: string; traceCtx?: string };
    expect(arg.traceCtx).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-0[0-9a-f]$/);
    expect(arg).toMatchObject({ title: "T", ingredients: [] });
  });

  it("propagates the action's error (after recording it on the span)", async () => {
    actionMock.mockImplementationOnce(() => Promise.reject(new Error("boom")));
    const { result } = renderHook(() =>
      useTracedAction("recipes.remove" as never, "recipes.remove"),
    );
    await expect(result.current({ id: "x" } as never)).rejects.toThrow("boom");
  });
});
