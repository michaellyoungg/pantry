import { context, SpanStatusCode, trace } from "@opentelemetry/api";
import { useAction } from "convex/react";
import type { FunctionArgs, FunctionReference, FunctionReturnType } from "convex/server";
import { useCallback } from "react";
import { currentTraceparent } from "./index";

const tracer = trace.getTracer("pantry-web");

// Wraps convex/react's useAction: starts a span, injects the active traceparent
// as the action's optional `traceCtx` arg (BL-0027 PR 2), and ends the span when
// the action settles. When telemetry is disabled the global tracer is a no-op:
// currentTraceparent() returns undefined, so args pass through UNCHANGED.
export function useTracedAction<Action extends FunctionReference<"action">>(
  ref: Action,
  spanName: string,
): (args: FunctionArgs<Action>) => Promise<FunctionReturnType<Action>> {
  const action = useAction(ref);
  return useCallback(
    (args: FunctionArgs<Action>) => {
      const span = tracer.startSpan(spanName);
      return context.with(trace.setSpan(context.active(), span), async () => {
        const traceparent = currentTraceparent();
        const merged = (
          traceparent ? { ...args, traceCtx: traceparent } : args
        ) as FunctionArgs<Action>;
        try {
          return await action(merged);
        } catch (e) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: e instanceof Error ? e.message : String(e),
          });
          if (e instanceof Error) span.recordException(e);
          throw e;
        } finally {
          span.end();
        }
      });
    },
    [action, spanName],
  );
}
