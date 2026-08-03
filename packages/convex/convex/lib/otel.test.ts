import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseTraceParent, withSpan } from "./otel";

const ENDPOINT = "http://alloy:4318";
// A canonical W3C traceparent (version 00).
const VALID_TP = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01";
const TRACE_ID = "0af7651916cd43dd8448eb211c80319c";
const PARENT_SPAN = "b7ad6b7169203331";

function firstSpan(bodies: any[]) {
  return bodies[0].resourceSpans[0].scopeSpans[0].spans[0];
}

describe("parseTraceParent", () => {
  it("parses a valid W3C traceparent", () => {
    expect(parseTraceParent(VALID_TP)).toEqual({
      traceId: TRACE_ID,
      spanId: PARENT_SPAN,
      flags: "01",
    });
  });

  it("rejects undefined, malformed, wrong-version, and all-zero ids", () => {
    expect(parseTraceParent(undefined)).toBeNull();
    expect(parseTraceParent("garbage")).toBeNull();
    expect(parseTraceParent(`01-${"a".repeat(32)}-${"b".repeat(16)}-01`)).toBeNull(); // version
    expect(parseTraceParent(`00-${"0".repeat(32)}-${"b".repeat(16)}-01`)).toBeNull(); // zero trace
    expect(parseTraceParent(`00-${"a".repeat(32)}-${"0".repeat(16)}-01`)).toBeNull(); // zero span
    expect(parseTraceParent(`00-${"a".repeat(31)}-${"b".repeat(16)}-01`)).toBeNull(); // short trace
  });
});

describe("withSpan — disabled (endpoint unset)", () => {
  beforeEach(() => vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", ""));
  afterEach(() => vi.unstubAllEnvs());

  it("runs fn, forwards the incoming traceCtx unchanged, and never fetches", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    let seen: string | undefined = "unset";
    const out = await withSpan("recipes.create", VALID_TP, async (tp) => {
      seen = tp;
      return 42;
    });
    expect(out).toBe(42);
    expect(seen).toBe(VALID_TP);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe("withSpan — enabled", () => {
  let bodies: any[];
  beforeEach(() => {
    vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", ENDPOINT);
    bodies = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: any) => {
        bodies.push(JSON.parse(String(init.body)));
        return new Response(null, { status: 200 });
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("POSTs one OTLP span to /v1/traces that inherits the trace id and parents on the incoming span", async () => {
    await withSpan("recipes.create", VALID_TP, async () => "ok");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((fetch as any).mock.calls[0][0]).toBe(`${ENDPOINT}/v1/traces`);
    const span = firstSpan(bodies);
    expect(span.traceId).toBe(TRACE_ID);
    expect(span.parentSpanId).toBe(PARENT_SPAN);
    expect(span.spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(span.spanId).not.toBe(PARENT_SPAN);
    expect(span.name).toBe("recipes.create");
    expect(span.status).toBeUndefined(); // success → no error status
    expect(bodies[0].resourceSpans[0].resource.attributes).toContainEqual({
      key: "service.name",
      value: { stringValue: "convex" },
    });
  });

  it("hands fn an outgoing traceparent carrying the same trace id and this span's id", async () => {
    let outgoing = "";
    await withSpan("recipes.create", VALID_TP, async (tp) => {
      outgoing = tp ?? "";
      return 0;
    });
    const span = firstSpan(bodies);
    expect(outgoing).toBe(`00-${TRACE_ID}-${span.spanId}-01`);
  });

  it("mints a fresh root trace when traceCtx is missing", async () => {
    await withSpan("recipes.list", undefined, async () => 0);
    const span = firstSpan(bodies);
    expect(span.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(span.parentSpanId).toBeUndefined();
  });

  it("returns the fn result even when the emitter throws (telemetry never breaks the request)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("alloy down");
      }),
    );
    const out = await withSpan("recipes.create", VALID_TP, async () => "value");
    expect(out).toBe("value");
  });

  it("rethrows the fn error but still emits a span with error status", async () => {
    await expect(
      withSpan("recipes.create", VALID_TP, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const span = firstSpan(bodies);
    expect(span.status).toEqual({ code: 2, message: "boom" });
  });
});
