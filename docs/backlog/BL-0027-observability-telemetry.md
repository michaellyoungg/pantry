---
id: BL-0027
title: Observability & telemetry (OpenTelemetry + Grafana LGTM)
status: proposed
area: infra
effort: L
related_specs: [2026-07-19-observability-telemetry-design.md]
created: 2026-07-19
---

## Context

The repo has no telemetry of any kind — no traces, no structured logs, no error
tracking. The Go recipe-service logs only at startup and swallows handler errors
into bare `writeError(w, 500, "...")`; Convex functions log nothing; the web app
has no error boundary and no error reporting.

A recipe import crosses browser → Convex action → Go service → Postgres. When it
fails mid-chain, there is currently no way to see where.

## Proposal

Instrument all three runtimes with OpenTelemetry, export through a **Grafana
Alloy** collector to a **`grafana/otel-lgtm`** all-in-one backend (Tempo + Loki
+ Grafana). Both new services sit behind a `profiles: [obs]` flag so the default
compose stack and CI are unaffected.

Signals in scope: **traces, structured logs, browser RUM**. Metrics, alerting,
sampling, and profiling are explicitly out of scope.

Ships as three PRs under this one item:

1. **Foundation + Go** — Alloy + LGTM compose services; `internal/telemetry`;
   `otelhttp` on the router (outside `requireService`, so auth failures trace);
   `otelpgx` on the pool; stdlib `log` → `slog` with trace-stamped lines.
2. **Convex** — `convex/lib/otel.ts` exposing `withSpan`; `traceCtx` args on
   `recipes.ts` actions; `traceparent` injection in `recipeServiceFetch`.
   Actions only — Convex queries/mutations cannot perform network I/O, so they
   cannot emit spans.
3. **Web** — OTel web SDK init, React error boundary, trace id threading into
   Convex action calls.

Hard requirement: instrumentation must be a **no-op when
`OTEL_EXPORTER_OTLP_ENDPOINT` is unset**, so existing `integration` and `e2e` CI
jobs run unchanged.

See [the design spec](../superpowers/specs/2026-07-19-observability-telemetry-design.md)
for architecture, the trace-correlation flow across the WebSocket boundary, and
rejected alternatives.

## Alternatives considered

- **Discrete LGTM components** (separate Tempo/Loki/Grafana/Mimir) — mirrors a
  production topology, but adds four services and five config files to an
  already five-service compose file for no local benefit. The Alloy exporter can
  be repointed at a decomposed stack later with no application code change.
- **SigNoz** — better out-of-the-box correlation, but pulls in ClickHouse +
  Zookeeper and has the heaviest local footprint.
- **Hosted free tier** (Grafana Cloud / Honeycomb) — zero local RAM and
  prod-ready immediately, but needs an account + API key, sends data off-box,
  and makes offline development impossible.
- **`otelcol-contrib` instead of Alloy** — vendor-neutral upstream YAML config.
  Alloy was chosen for its pipeline debugging UI, since silent non-delivery of
  telemetry is the usual failure mode when standing up a stack. Both speak plain
  OTLP, so the swap stays cheap.
- **No collector, export direct to LGTM** — one less service, but loses browser
  CORS termination, the single PII-scrub point, and makes the eventual prod swap
  a three-codebase change instead of one file.

## Relationship to other items

- **BL-0006 (Railway deployment)** — production export destination is deferred
  to that item. This item only changes the Alloy exporter block when it lands.
- **BL-0008 (Self-hosted Convex prod hardening)** — shares the image-pinning
  discipline; Alloy and LGTM images should be pinned the same way.
