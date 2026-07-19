# Observability & telemetry — OpenTelemetry + Grafana LGTM

**Date:** 2026-07-19
**Backlog item:** BL-0027
**Status:** design approved, not yet implemented

## Problem

The repo has no telemetry of any kind. A repo-wide search for
`sentry|posthog|datadog|otel|opentelemetry|prometheus|grafana|jaeger` returns
only prose mentions. Concretely:

- The Go recipe-service uses stdlib `log`, and only in `cmd/server/main.go` —
  there is **no request logging and no logging inside handlers or stores**.
  Errors are swallowed into `writeError(w, 500, "...")`, so a production 500
  leaves no trace of what failed.
- Convex functions contain no logging at all; errors are bare `throw new Error`.
- The web app has no error tracking and no error boundary. Failures reach
  `console.error` in two components and nowhere else.
- A recipe import crosses browser → Convex action → Go service → Postgres. When
  it fails mid-chain today, there is no way to see where.

## Goals

1. One recipe import appears as **one distributed trace** spanning all runtimes.
2. Every Go 500 has a structured log line correlated to that trace.
3. Browser errors are captured rather than lost to the console.
4. The backend is swappable — instrument once, change destination by config.

## Non-goals (YAGNI)

Metrics/Mimir, alerting, sampling strategies, continuous profiling, and any
Railway/production wiring. Prod deployment belongs to BL-0006. 100% sampling is
correct at local-development volume.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Instrumentation API | OpenTelemetry | Vendor-neutral; the only choice that spans Go + browser + a V8 isolate |
| Collector | **Grafana Alloy** | Built-in pipeline debug UI on `:12345`; ecosystem-consistent with the chosen backend. Speaks standard OTLP both directions, so portability is retained |
| Backend | **`grafana/otel-lgtm`** (all-in-one) | Tempo + Loki + Prometheus + Grafana in one container with datasources pre-wired. One compose service instead of four-plus-config-files |
| Signals | Traces, structured logs, browser RUM | Metrics deferred — they serve dashboards/alerting, which is a prod concern |
| Convex coverage | Manual spans, **actions only** | Queries/mutations cannot perform network I/O in Convex, so they physically cannot emit spans |
| Delivery | One backlog item, three PRs | Each PR independently reviewable and useful |

### Backends considered and rejected

- **Discrete LGTM components** (separate Tempo/Loki/Grafana/Mimir services) —
  mirrors a production topology, but adds four services and five config files to
  an already five-service compose file for no local benefit. The Alloy exporter
  can be repointed at a decomposed stack later without touching app code.
- **SigNoz** — genuinely better out-of-the-box trace/log correlation, but pulls
  in ClickHouse + Zookeeper, the heaviest local footprint of the options, and a
  smaller ecosystem.
- **Hosted free tier** (Grafana Cloud / Honeycomb) — zero local RAM and
  prod-ready immediately, but requires an account and API key, sends data
  off-box, and makes offline development impossible. Local development in this
  repo already requires a running Convex backend; adding a network dependency
  for telemetry compounds that.

### Collector: Alloy vs. otelcol-contrib

`otel/opentelemetry-collector-contrib` is the upstream CNCF distribution with
standard YAML config. Alloy is Grafana's distribution of the same collector —
all upstream OTel components plus Prometheus/Loki/Pyroscope-native ones,
configured in Alloy syntax.

Alloy was chosen for its pipeline debugging UI, which matters because
"telemetry silently isn't arriving" is the most common failure mode when
standing up a stack like this. The cost is a non-standard config dialect and a
mild Grafana tie-in. Because Alloy receives and exports plain OTLP, swapping it
for contrib later is a container-image and config-file change with no
application code impact.

## Architecture

```
┌─ browser (React/Vite) ───────────────────┐
│  @opentelemetry/sdk-trace-web            │
│  + React error boundary                  │
└──────────┬───────────────────────────────┘
           │ OTLP/HTTP  (traceparent minted here)
           │ trace id also passed as a plain arg ──┐
           ▼                                        ▼
   ┌───────────────────┐              ┌─ Convex actions (V8 isolate) ──┐
   │  Grafana Alloy    │◄─ OTLP/HTTP ─│  hand-rolled OTLP JSON emitter │
   │  UI on :12345     │              │  recipes.ts only               │
   └─────────┬─────────┘              └──────────────┬─────────────────┘
             │                                        │ traceparent header
             │ OTLP/gRPC                               ▼
             ▼                          ┌─ Go recipe-service ───────────┐
   ┌───────────────────┐                │  otelhttp middleware          │
   │  grafana/otel-lgtm│◄─── OTLP ───── │  slog → stdout, trace-stamped │
   │  Tempo+Loki+Graf. │                │  otelpgx → Postgres spans     │
   └───────────────────┘                └───────────────────────────────┘
```

### Why a collector at all

Alloy is the seam that makes everything else swappable:

- **CORS termination** for browser OTLP, which the LGTM container should not do.
- **PII scrubbing in one place**, before anything is stored.
- **Backend portability** — no application code ever names Grafana.

The Go service ships as a **distroless/nonroot** image, so it has no shell and
cannot run a collector as a sidecar process. The collector must be its own
compose service.

### Units and interfaces

Each runtime gets one small telemetry module, so instrumentation never leaks
into business logic.

| Unit | Location | Interface | Depends on |
|---|---|---|---|
| Go tracing bootstrap | `apps/recipe-service/internal/telemetry/telemetry.go` | `Init(ctx) (shutdown func, err)` | OTel Go SDK |
| Go log handler | `apps/recipe-service/internal/telemetry/log.go` | `slog.Handler` stamping trace/span id | `log/slog` |
| Convex emitter | `packages/convex/convex/lib/otel.ts` | `withSpan(name, traceCtx, fn)` | `fetch` only |
| Web bootstrap | `apps/web/src/telemetry/index.ts` | `initTelemetry()`, `currentTraceId()` | OTel web SDK |

The Convex emitter is the only bespoke code. Confining the OTLP-JSON
construction behind a single `withSpan` wrapper keeps it in one testable file;
`recipes.ts` only ever sees `withSpan`.

## Trace correlation

Making one import into one trace is the hardest requirement, because the
browser talks to Convex over a **WebSocket** — there is no per-call HTTP header
to inject into.

1. **Browser mints the trace.** The web SDK starts a root span on user action;
   `currentTraceId()` extracts it.
2. **Browser → Convex: trace id as an argument.** Convex actions take
   `traceCtx: v.optional(v.string())` carrying a W3C `traceparent` string. It is
   a plain argument specifically because the WebSocket transport offers no
   header. This is the deliberate workaround, not an oversight.
3. **Convex emits its span.** `withSpan` parses the incoming `traceparent` to
   inherit the trace id, mints a fresh span id, times the wrapped function, and
   POSTs OTLP JSON to Alloy. The emitter **swallows its own errors** — telemetry
   must never fail a user request.
4. **Convex → Go: a real `traceparent` header.** `recipeServiceFetch`
   (`packages/convex/convex/recipes.ts:21`) already sets `X-Service-Secret` and
   `X-User-Id`; it gains one more header. This is the sole cross-service egress
   point, so one edit covers every call.
5. **Go continues the trace.** `otelhttp` wraps the mux **outside**
   `requireService`, so authentication failures are traced too. Context
   extraction is automatic.
6. **Go logs carry the ids.** A custom `slog.Handler` pulls `trace_id`/`span_id`
   off the request context onto every line, giving bidirectional Loki ↔ Tempo
   navigation. This is why logs and traces had to be designed together.

## Error handling

Every layer marks its span `StatusError` and records the exception. This
directly addresses the worst finding in the survey: Go handler errors currently
vanish into `writeError(w, 500, "...")` with no log line at all. After this
work, every 500 has a stack, a trace, and a correlated log.

## Privacy

Alloy drops `user.email` and hashes `user.id` before export. The scrub lives in
the pipeline rather than in application code so it cannot be forgotten at an
individual call site.

## Delivery plan

**PR 1 — Foundation + Go.** Alloy and `grafana/otel-lgtm` compose services,
both behind `profiles: [obs]` so the default `docker compose up` stays lean and
CI does not pay for them. Go gains `internal/telemetry`, `otelhttp` on the
router, `otelpgx` on the pool, and `slog` replacing stdlib `log` throughout.
Self-contained: after PR 1, a `curl` against recipe-service traces end to end
with DB spans, before any TypeScript is touched.

**PR 2 — Convex.** `lib/otel.ts` with `withSpan`, `traceCtx` arguments on
`recipes.ts` actions, `traceparent` injection in `recipeServiceFetch`.

**PR 3 — Web.** `src/telemetry/`, SDK init in `main.tsx`, a React error boundary
(the app has none today), and trace id threading into Convex action calls.

## Testing

- **Go:** table tests asserting the `slog` handler stamps ids from context; an
  `httptest` case asserting a span is recorded with error status on a 500.
- **Convex:** `convex-test` with a stubbed `fetch`, asserting `withSpan` emits
  well-formed OTLP JSON and — importantly — that a **throwing emitter never
  fails the wrapped function**.
- **Web:** Vitest asserting `currentTraceId()` returns a valid W3C trace id.

Each PR must hold the existing coverage ratchet (lines 50 / functions 40 /
branches 45 / statements 48).

## CI

No new jobs. Instrumentation must be a **no-op when
`OTEL_EXPORTER_OTLP_ENDPOINT` is unset**, so the existing `integration` and
`e2e` jobs run unchanged. This is a hard requirement — without it, CI wedges on
a collector that isn't there.

## Open questions for implementation time

- Exact Alloy image tag to pin (the repo pins Convex images by digest per
  BL-0008; the same discipline should apply here).
- Whether `grafana/otel-lgtm` data should persist to `./.data/lgtm` or stay
  ephemeral. Ephemeral is likely fine for local dev and avoids gitignore churn.
