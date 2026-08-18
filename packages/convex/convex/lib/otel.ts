// Minimal OTLP/JSON trace emitter for Convex actions. Convex runs functions in a
// V8 isolate where only actions can perform network I/O, so this is the only
// place spans can be produced (queries/mutations physically cannot fetch).
//
// Rules that must not regress (see BL-0027 spec):
//  - No-op when OTEL_EXPORTER_OTLP_ENDPOINT is unset (the CI/no-op contract).
//  - Telemetry never fails a user request: emission errors are swallowed here;
//    only the wrapped function's own error propagates.
//  - The browser talks to Convex over a WebSocket, so the incoming W3C
//    `traceparent` arrives as a plain string arg (`traceCtx`), not a header.
//  - OTLP/JSON encodes traceId/spanId as lowercase hex strings.

const HEX = "0123456789abcdef";

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let out = "";
  for (const b of buf) out += HEX[(b >> 4) & 0xf] + HEX[b & 0xf];
  return out;
}

export interface TraceParent {
  traceId: string;
  spanId: string;
  flags: string;
}

// Parse a W3C `traceparent`: `00-<32hex trace>-<16hex span>-<2hex flags>`.
// Returns null for anything not a well-formed, non-zero version-00 header.
export function parseTraceParent(traceCtx: string | undefined): TraceParent | null {
  if (!traceCtx) return null;
  const parts = traceCtx.split("-");
  if (parts.length !== 4) return null;
  const [version, traceId, spanId, flags] = parts;
  if (version !== "00") return null;
  if (!/^[0-9a-f]{32}$/.test(traceId) || traceId === "0".repeat(32)) return null;
  if (!/^[0-9a-f]{16}$/.test(spanId) || spanId === "0".repeat(16)) return null;
  if (!/^[0-9a-f]{2}$/.test(flags)) return null;
  return { traceId, spanId, flags };
}

interface SpanShape {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startNano: string;
  endNano: string;
  error?: unknown;
}

function toOtlp(span: SpanShape): unknown {
  const s: Record<string, unknown> = {
    traceId: span.traceId,
    spanId: span.spanId,
    name: span.name,
    kind: 3, // SPAN_KIND_CLIENT — the action calls out to recipe-service
    startTimeUnixNano: span.startNano,
    endTimeUnixNano: span.endNano,
  };
  if (span.parentSpanId) s.parentSpanId = span.parentSpanId;
  if (span.error !== undefined) {
    // Bound to a local first: narrowing a property access does not carry into
    // the `String(...)` fallback, so the type-aware linter cannot see that the
    // non-Error branch is the deliberate last resort rather than an object
    // about to stringify as "[object Object]".
    const thrown: unknown = span.error;
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    s.status = { code: 2, message }; // STATUS_CODE_ERROR
  }
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [{ key: "service.name", value: { stringValue: "convex" } }],
        },
        scopeSpans: [{ scope: { name: "pantry-convex" }, spans: [s] }],
      },
    ],
  };
}

async function emit(endpoint: string, span: SpanShape): Promise<void> {
  // Swallow everything: telemetry must never fail or slow-fail a user request.
  try {
    await fetch(`${endpoint}/v1/traces`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(toOtlp(span)),
    });
  } catch {
    // ignore — no telemetry is better than a broken request
  }
}

function nowNano(): string {
  // Date.now() is millisecond-resolution; OTLP wants unix nanoseconds.
  return (BigInt(Date.now()) * 1_000_000n).toString();
}

/**
 * Wrap an action body in a span. `fn` receives the outgoing W3C `traceparent`
 * to forward to recipe-service (so the Go server span nests under this one).
 * When telemetry is disabled the incoming `traceCtx` is passed straight through
 * and no span is produced.
 */
export async function withSpan<T>(
  name: string,
  traceCtx: string | undefined,
  fn: (traceparent: string | undefined) => Promise<T>,
): Promise<T> {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) {
    return fn(traceCtx); // no-op path: forward what came in, emit nothing
  }

  const parent = parseTraceParent(traceCtx);
  const traceId = parent?.traceId ?? randomHex(16);
  const spanId = randomHex(8);
  const flags = parent?.flags ?? "01";
  const outgoing = `00-${traceId}-${spanId}-${flags}`;
  const startNano = nowNano();

  let error: unknown;
  try {
    return await fn(outgoing);
  } catch (e) {
    error = e;
    throw e;
  } finally {
    await emit(endpoint, {
      traceId,
      spanId,
      parentSpanId: parent?.spanId,
      name,
      startNano,
      endNano: nowNano(),
      error,
    });
  }
}
