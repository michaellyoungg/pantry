import { context, propagation, trace } from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  StackContextManager,
  TracerProvider,
} from "@opentelemetry/sdk-trace";
import { afterEach, describe, expect, it, vi } from "vitest";
import { currentTraceparent, initTelemetry, isTelemetryEnabled } from "./index";

describe("initTelemetry", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    trace.disable(); // reset the global provider so tests don't leak into each other
    context.disable();
    propagation.disable();
  });

  it("is a no-op when the endpoint is unset (registers no global provider)", () => {
    vi.stubEnv("VITE_OTEL_EXPORTER_OTLP_ENDPOINT", "");
    initTelemetry();
    // No active span and no provider → no traceparent.
    expect(currentTraceparent()).toBeUndefined();
  });

  it("registers a provider when the endpoint is set and is idempotent", () => {
    vi.stubEnv("VITE_OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4318");
    expect(() => {
      initTelemetry();
      initTelemetry(); // second call must be a no-op, not throw or double-register
    }).not.toThrow();
    expect(isTelemetryEnabled()).toBe(true);

    // The context manager and the W3C propagator are what carry a span from the
    // browser into the Convex action. Without either, the inject sees no span.
    const span = trace.getTracer("test").startSpan("s");
    const carrier: Record<string, string> = {};
    context.with(trace.setSpan(context.active(), span), () =>
      propagation.inject(context.active(), carrier),
    );
    span.end();
    expect(carrier.traceparent).toBe(currentTraceparentFor(span));
  });
});

function currentTraceparentFor(span: ReturnType<ReturnType<typeof trace.getTracer>["startSpan"]>) {
  const sc = span.spanContext();
  return `00-${sc.traceId}-${sc.spanId}-0${(sc.traceFlags & 1).toString(16)}`;
}

describe("isTelemetryEnabled", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is false when VITE_OTEL_EXPORTER_OTLP_ENDPOINT is unset/empty", () => {
    vi.stubEnv("VITE_OTEL_EXPORTER_OTLP_ENDPOINT", "");
    expect(isTelemetryEnabled()).toBe(false);
  });

  it("is true when the endpoint is set", () => {
    vi.stubEnv("VITE_OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4318");
    expect(isTelemetryEnabled()).toBe(true);
  });
});

describe("currentTraceparent", () => {
  it("returns undefined when there is no active recording span", () => {
    expect(currentTraceparent()).toBeUndefined();
  });

  it("returns a well-formed W3C traceparent for the active span", () => {
    // Register a real (in-memory) provider so a started span has a valid context.
    const provider = new TracerProvider({
      spanProcessors: [new SimpleSpanProcessor({ exporter: new InMemorySpanExporter() })],
    });
    context.setGlobalContextManager(new StackContextManager().enable());
    const tracer = provider.getTracer("test");
    const span = tracer.startSpan("op");
    const tp = context.with(trace.setSpan(context.active(), span), () => currentTraceparent());
    span.end();
    context.disable();
    expect(tp).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-0[0-9a-f]$/);
    const sc = span.spanContext();
    expect(tp).toBe(`00-${sc.traceId}-${sc.spanId}-0${sc.traceFlags.toString(16)}`);
  });
});
