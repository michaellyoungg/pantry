# Pantry

A unified platform for planning meals, discovering recipes, and shopping smarter.

Pantry helps you collect recipes you want to cook, turn them into a single
aggregated grocery list, and (over time) cook from what you already have on hand
to reduce food waste.

## Status

Early development. The first milestone is a **walking skeleton** of the core
loop: *create recipes → add to a meal basket → generate one aggregated grocery
list → check items off live*. See
[`docs/superpowers/specs`](docs/superpowers/specs) for the current design and
[`docs/backlog`](docs/backlog) for planned future work.

## Architecture (target)

A hybrid, multi-service monorepo:

- **`apps/web`** — React (Vite) web app.
- **`apps/recipe-service`** — Go + Postgres. Canonical source of truth for
  recipe definitions, ingredient data, and grocery-list aggregation. Also hosts
  `internal/recommend`, a dependency-free scoring package behind
  `POST /recommendations/*`. It holds no user state — Convex passes the full
  user context per request — which is what lets it live here as a module
  instead of a separate service.
- **`convex/`** — self-hosted Convex. User-centric reactive data: profile,
  preferences, the meal basket, and the live grocery list. Stores references to
  recipe ids only — never recipe bodies.
- **`packages/core`** — the headless domain layer: planner bucketing, aisle
  grouping, the import-review draft, and the shared async/optimistic hooks. No
  React in the pure entry point, no DOM anywhere — so a second client can reuse
  it. See [`packages/core/README.md`](packages/core/README.md).
- **`packages/*`** — other shared TypeScript packages (types, etc.).

Local development runs everything via `docker compose`. Production targets
Railway (self-hosted Convex + Postgres).

## Local development

### Seed the catalog

The shared recipe catalog (system-owned browse-and-pick recipes) is loaded by a
one-shot seed job against the Postgres-backed stack:

```bash
docker compose up -d postgres recipe-service
docker compose run --rm seed
```

Re-running is safe — recipes upsert by stable id. The catalog requires Postgres;
running recipe-service with the in-memory store (no `DATABASE_URL`) has an empty
catalog.

## Testing

### Unit tests

Fast, hermetic, no external services. Run in CI on every push/PR.

```bash
pnpm test            # all workspaces (web, convex, go)
```

- **web** — Vitest + jsdom (components + lib).
- **convex** — `convex-test` runs functions against an in-memory backend.
- **recipe-service** — `go test ./...` (DB-backed tests skip without a database).

### Integration tests

Verify the seams **between** services with no mocks:

- **recipe-service ⇄ Postgres** (`postgres_test.go`) — the real DB code path.
- **Convex actions ⇄ recipe-service ⇄ Postgres** (`recipes.integration.test.ts`)
  — the Convex actions in `packages/convex/convex/recipes.ts` make genuine HTTP
  calls (paths, `X-Service-Secret`/`X-User-Id` headers, JSON shapes) to a real
  running recipe-service. Catches contract drift the unit suites can't.

Run the full suite against a real Postgres (needs Docker + Go):

```bash
pnpm test:integration
```

This starts the compose Postgres, creates a dedicated `pantry_test` database
(never touches dev `pantry`), runs the Go DB tests, then runs the Convex
contract tests against a freshly built recipe-service.

Just the cross-service contract, **no infrastructure** (the service falls back to
its in-memory store when no database is set):

```bash
pnpm --filter @pantry/convex test:integration
```

In CI, the `go` and `integration` jobs run these against a Postgres service
container on every push/PR — so CI and local verify the same seams.

### End-to-end (browser)

The full user loop, driven in a real browser (Playwright) against a complete
compose-up stack — *sign up → create a recipe → plan a day → generate the
aggregated grocery list → check an item off → reload persists*. This catches
cross-service regressions the unit + integration suites can't: Convex Auth over
the self-hosted backend, Convex reactivity, the Convex→recipe-service HTTP
aggregation, and the controlled-checkbox round-trip.

```bash
# once, to install the browser + its OS deps:
pnpm --filter @pantry/web exec playwright install --with-deps chromium
# then, from the repo root:
pnpm test:e2e
```

`pnpm test:e2e` runs [`scripts/e2e.sh`](scripts/e2e.sh), which brings up the
stack, seeds the shared recipe catalog, provisions the Convex deployment (admin
key, auth JWT keys, recipe-service wiring), pushes the Convex functions, and then
runs Playwright — which starts the Vite dev server itself. Each run signs up a
fresh unique account, so it is self-isolating; the seeded catalog is the one
piece of shared state every account sees, which is what lets the suite cover
browsing and planning a recipe the signed-in user did not write. It is **deliberately not part of `pnpm test`** (which stays
unit-only and fast) or the per-PR CI gate — it needs Docker, Go, and a browser.
Set `E2E_KEEP_STACK=1` to leave the stack up for debugging; pass extra flags
through to Playwright, e.g. `pnpm test:e2e --headed`.

## Observability

Traces and structured logs go to a local Grafana stack (BL-0027). It is opt-in —
the default `docker compose up` runs without it.

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://alloy:4318 docker compose --profile obs up
```

| URL | What |
|---|---|
| http://localhost:3001 | Grafana — Explore → Tempo for traces, Loki for logs |
| http://localhost:12345 | Alloy pipeline UI — check here first when telemetry is missing |

Convex actions in `recipes.ts` emit their own spans and forward a W3C
`traceparent` to recipe-service, so a browser→Convex→Go request is one trace.
The browser↔Convex transport is a WebSocket, so the trace id crosses that hop as
a plain `traceCtx` action argument rather than a header. Convex reads its OTLP
endpoint from the deployment env — enable it with:

```bash
convex env set OTEL_EXPORTER_OTLP_ENDPOINT http://alloy:4318
```

Like every layer, Convex tracing is a no-op when that variable is unset.

The web app (`apps/web`) uses the OpenTelemetry web SDK: a user action mints a
browser root span, whose `traceparent` is threaded into the Convex action call as
`traceCtx`, so the whole browser→Convex→Go path is one trace. A React error
boundary records uncaught render errors as spans. Enable it with a
browser-visible var pointing at the **host-published** Alloy port (the browser
can't resolve the `alloy` docker name):

```bash
VITE_OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 pnpm --filter @pantry/web dev
```

Unset, the web SDK is a no-op — no provider, no network — so tests and e2e are
unaffected.

Telemetry is a **complete no-op when `OTEL_EXPORTER_OTLP_ENDPOINT` is unset**, so
CI and the plain compose stack are unaffected. Log lines carry `trace_id` and
`span_id`, so you can pivot from any log line to its trace and back.

## Operating self-hosted Convex

Self-hosting means we own the operations Convex Cloud would run for us. The
runbook is [`docs/self-hosted-convex-ops.md`](docs/self-hosted-convex-ops.md):
Postgres backing, what a backup does and does not cover, how a restore actually
goes, the image-upgrade procedure, and the dashboard access model.

```bash
docker compose -f docker-compose.yml \
               -f deploy/docker-compose.convex-postgres.yml up -d  # Postgres-backed

scripts/convex-backup.sh          # snapshot (data + file storage) -> .backups/
scripts/convex-restore.sh <zip> --yes
scripts/convex-restore-drill.sh   # back up, DESTROY, restore, verify — on a scratch stack
```

The drill is the point. It runs under its own compose project with its own named
volumes and shifted ports, so it cannot touch your `./.data` — it is safe to run
while the normal stack is up, and a restore procedure nobody has run is a
hypothesis.
