import { context, trace } from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { WebTracerProvider } from "@opentelemetry/sdk-trace-web";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

// The browser posts OTLP/HTTP to the host-published Alloy port; unset = disabled.
function endpoint(): string | undefined {
  const e = import.meta.env.VITE_OTEL_EXPORTER_OTLP_ENDPOINT;
  return e && e.length > 0 ? e : undefined;
}

export function isTelemetryEnabled(): boolean {
  return endpoint() !== undefined;
}

let started = false;

// Registers the global WebTracerProvider. No-op (and no network) when the OTLP
// endpoint env is unset, so tests, e2e, and the default runtime are unaffected.
export function initTelemetry(): void {
  if (started) return;
  const url = endpoint();
  if (!url) return;
  started = true;

  const provider = new WebTracerProvider({
    resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: "web" }),
    spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter({ url: `${url}/v1/traces` }))],
  });
  provider.register({ propagator: new W3CTraceContextPropagator() });
}

// The W3C `traceparent` for the currently-active span, or undefined when no
// recording span is active (which includes the disabled/no-op-tracer case).
export function currentTraceparent(): string | undefined {
  const span = trace.getSpan(context.active());
  if (!span) return undefined;
  const sc = span.spanContext();
  if (!sc || !sc.traceId || sc.traceId === "0".repeat(32)) return undefined;
  const flags = `0${(sc.traceFlags & 1).toString(16)}`;
  return `00-${sc.traceId}-${sc.spanId}-${flags}`;
}
