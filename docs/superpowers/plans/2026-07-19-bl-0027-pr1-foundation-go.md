# BL-0027 PR 1 — Observability Foundation + Go Instrumentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Go recipe-service emit OpenTelemetry traces and trace-correlated structured logs to a local Grafana Alloy → `grafana/otel-lgtm` stack, with zero behaviour change when telemetry is switched off.

**Architecture:** A new `internal/telemetry` package owns two things and nothing else: an OTLP tracer-provider bootstrap (`Init`) and a `slog.Handler` that stamps trace/span ids onto every log line. The router is wrapped in `otelhttp` *outside* the existing `requireService` middleware so authentication failures are traced too, and the pgx pool gets `otelpgx` so database calls become child spans. Two new compose services (Alloy, `otel-lgtm`) sit behind a `profiles: [obs]` flag so the default stack and CI are untouched.

**Tech Stack:** Go 1.25, `log/slog`, OpenTelemetry Go SDK, `otelhttp`, `otelpgx`, pgx/v5, Grafana Alloy, `grafana/otel-lgtm`, Docker Compose.

**Design spec:** [`docs/superpowers/specs/2026-07-19-observability-telemetry-design.md`](../specs/2026-07-19-observability-telemetry-design.md)

## Global Constraints

These apply to **every** task. Each task's requirements implicitly include this section.

- **Telemetry must be a complete no-op when `OTEL_EXPORTER_OTLP_ENDPOINT` is unset.** No exporter, no background goroutines, no connection attempts, no log noise. The existing `integration` and `e2e` CI jobs run without a collector and must stay green. This is the single hardest requirement in the plan.
- **No new CI jobs.** `.github/workflows/ci.yml` is not modified by this PR.
- **Coverage ratchet holds:** the `go` job runs `go test -race -cover`. Do not let coverage regress.
- **Lint:** `apps/recipe-service/.golangci.yml` (v2 schema) must pass. Run `golangci-lint run` before every commit.
- **The service image is `gcr.io/distroless/static-debian12:nonroot`** — no shell, no sidecar process. The collector is always a separate compose service.
- **Pin container images by digest**, following the BL-0008 discipline already used for the Convex images in `docker-compose.yml`.
- **Module path is `pantry/apps/recipe-service`** — all internal imports start with that prefix.
- **Do not open the PR as a draft** (see `CLAUDE.md`).
- All commands below run from `apps/recipe-service/` unless the step says otherwise.

## File Structure

| File | Responsibility |
|---|---|
| `internal/telemetry/telemetry.go` (create) | `Init` — build/install the tracer provider, return a shutdown func. Returns a no-op when the endpoint env var is unset. |
| `internal/telemetry/log.go` (create) | `TraceHandler` — a `slog.Handler` decorator stamping `trace_id`/`span_id` from context. |
| `internal/telemetry/telemetry_test.go` (create) | Tests for `Init`'s no-op contract. |
| `internal/telemetry/log_test.go` (create) | Tests for trace stamping, including the `WithAttrs` pitfall. |
| `internal/recipe/handler.go` (modify) | Route registration via a span-naming helper; `writeError`/`writeErr` record on the span and log. |
| `internal/recipe/middleware.go` (modify) | Updated `writeError` call sites. |
| `internal/recipe/postgres.go` (modify) | Pool built from a parsed config with `otelpgx` tracer attached. |
| `internal/recipe/telemetry_test.go` (create) | End-to-end span assertions through the real router. |
| `cmd/server/main.go` (modify) | `slog` replaces stdlib `log`; `telemetry.Init` wired into the existing lifecycle/drain path. |
| `cmd/seed/main.go` (modify) | `slog` replaces stdlib `log` for consistency. |
| `alloy/config.alloy` (create, repo root) | Alloy pipeline: OTLP in → scrub → batch → OTLP out to LGTM. |
| `docker-compose.yml` (modify, repo root) | `alloy` + `otel-lgtm` services behind `profiles: [obs]`. |
| `README.md` (modify, repo root) | How to run the observability stack. |

`telemetry` deliberately does not import `recipe`, and `recipe` imports `telemetry` only for the handler type. This keeps the dependency one-directional and the telemetry package independently testable.

---

### Task 1: Telemetry package — `Init` and its no-op contract

**Files:**
- Create: `apps/recipe-service/internal/telemetry/telemetry.go`
- Create: `apps/recipe-service/internal/telemetry/telemetry_test.go`
- Modify: `apps/recipe-service/go.mod`, `apps/recipe-service/go.sum`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `telemetry.Init(ctx context.Context, serviceName string) (shutdown func(context.Context) error, err error)`. `shutdown` is **always non-nil**, even on the no-op path and even when `err != nil`, so callers can `defer` it unconditionally.

- [ ] **Step 1: Add the OpenTelemetry dependencies**

```bash
go get go.opentelemetry.io/otel
go get go.opentelemetry.io/otel/sdk
go get go.opentelemetry.io/otel/trace
go get go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp
go get go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp
go mod tidy
```

- [ ] **Step 2: Write the failing test**

Create `internal/telemetry/telemetry_test.go`:

```go
package telemetry_test

import (
	"context"
	"testing"

	"pantry/apps/recipe-service/internal/telemetry"
)

// Init must be a complete no-op when the OTLP endpoint is unset: the existing
// integration and e2e CI jobs run without a collector, and any exporter that
// tries to dial one would spew errors or hang on shutdown.
func TestInitIsNoopWithoutEndpoint(t *testing.T) {
	t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "")

	shutdown, err := telemetry.Init(context.Background(), "test-service")
	if err != nil {
		t.Fatalf("Init() error = %v, want nil", err)
	}
	if shutdown == nil {
		t.Fatal("Init() shutdown = nil, want a callable no-op")
	}
	if err := shutdown(context.Background()); err != nil {
		t.Fatalf("shutdown() error = %v, want nil", err)
	}
}

// Even on the failure path the caller must be able to `defer shutdown(...)`
// without a nil check.
func TestInitReturnsCallableShutdownOnBadEndpoint(t *testing.T) {
	t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "://not-a-url")

	shutdown, _ := telemetry.Init(context.Background(), "test-service")
	if shutdown == nil {
		t.Fatal("Init() shutdown = nil on error path, want a callable no-op")
	}
	if err := shutdown(context.Background()); err != nil {
		t.Fatalf("shutdown() error = %v, want nil", err)
	}
}
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `go test ./internal/telemetry/ -run TestInit -v`
Expected: FAIL — build error, `undefined: telemetry.Init` (the package does not exist yet).

- [ ] **Step 4: Write the implementation**

Create `internal/telemetry/telemetry.go`:

```go
// Package telemetry owns OpenTelemetry setup for the recipe service: tracer
// provider bootstrap and trace-correlated structured logging. It deliberately
// knows nothing about recipes.
package telemetry

import (
	"context"
	"fmt"
	"os"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
)

// noopShutdown is returned whenever there is no provider to tear down, so
// callers can always `defer shutdown(ctx)` without a nil check.
func noopShutdown(context.Context) error { return nil }

// Init installs a global tracer provider exporting OTLP over HTTP, and returns
// its shutdown func.
//
// When OTEL_EXPORTER_OTLP_ENDPOINT is unset, Init installs nothing and returns
// a no-op: the global provider stays the OTel default no-op provider, so every
// instrumentation call in the codebase becomes free. This is what lets the
// integration and e2e CI jobs run without a collector.
//
// Endpoint, headers, and timeouts are read from the standard OTEL_* environment
// variables by the exporter itself; we only check the endpoint to decide
// whether to wire anything up at all.
func Init(ctx context.Context, serviceName string) (func(context.Context) error, error) {
	if os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT") == "" {
		return noopShutdown, nil
	}

	exporter, err := otlptracehttp.New(ctx)
	if err != nil {
		return noopShutdown, fmt.Errorf("otlp trace exporter: %w", err)
	}

	res, err := resource.Merge(
		resource.Default(),
		resource.NewWithAttributes(semconv.SchemaURL, semconv.ServiceName(serviceName)),
	)
	if err != nil {
		return noopShutdown, fmt.Errorf("telemetry resource: %w", err)
	}

	tp := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exporter),
		sdktrace.WithResource(res),
	)
	otel.SetTracerProvider(tp)

	// W3C trace context is how the trace id arrives from Convex (as a
	// `traceparent` header) — without this propagator the Go spans would start
	// a brand new trace instead of joining the existing one.
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	))

	return tp.Shutdown, nil
}
```

> If the `semconv/v1.26.0` import path fails to resolve, run `go list -m -versions go.opentelemetry.io/otel` and use the highest `semconv/vX.Y.Z` directory present in the resolved module, adjusting the import line to match. `semconv.ServiceName` and `semconv.SchemaURL` exist in every version from v1.21.0 onward.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `go test ./internal/telemetry/ -v`
Expected: PASS — both `TestInitIsNoopWithoutEndpoint` and `TestInitReturnsCallableShutdownOnBadEndpoint`.

- [ ] **Step 6: Lint**

Run: `golangci-lint run ./internal/telemetry/...`
Expected: no output (clean).

- [ ] **Step 7: Commit**

```bash
git add go.mod go.sum internal/telemetry/
git commit -m "feat(recipe-service): add telemetry package with no-op-by-default tracer init"
```

---

### Task 2: Trace-stamping slog handler

**Files:**
- Create: `apps/recipe-service/internal/telemetry/log.go`
- Create: `apps/recipe-service/internal/telemetry/log_test.go`

**Interfaces:**
- Consumes: nothing from Task 1 at compile time (same package, separate file).
- Produces: `telemetry.NewTraceHandler(inner slog.Handler) slog.Handler`. Wraps any handler; adds `trace_id` and `span_id` string attributes to records logged with a context carrying a valid span.

**Why this is its own task:** there is a specific, easy-to-miss bug in `slog.Handler` decorators. If you embed `slog.Handler` and don't override `WithAttrs`/`WithGroup`, those methods return the *inner* handler and silently strip your decoration — so `logger.With("k","v")` loses trace ids. The second test below exists to catch exactly that.

- [ ] **Step 1: Write the failing tests**

Create `internal/telemetry/log_test.go`:

```go
package telemetry_test

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"testing"

	sdktrace "go.opentelemetry.io/otel/sdk/trace"

	"pantry/apps/recipe-service/internal/telemetry"
)

// startSpan returns a context carrying a real recording span, plus the ids we
// expect to see on log lines.
func startSpan(t *testing.T) (context.Context, string, string) {
	t.Helper()
	tp := sdktrace.NewTracerProvider()
	t.Cleanup(func() { _ = tp.Shutdown(context.Background()) })

	ctx, span := tp.Tracer("test").Start(context.Background(), "op")
	t.Cleanup(span.End)

	sc := span.SpanContext()
	return ctx, sc.TraceID().String(), sc.SpanID().String()
}

func logLine(t *testing.T, buf *bytes.Buffer) map[string]any {
	t.Helper()
	var got map[string]any
	if err := json.Unmarshal(buf.Bytes(), &got); err != nil {
		t.Fatalf("log output is not valid JSON (%v): %s", err, buf.String())
	}
	return got
}

func TestHandlerStampsTraceAndSpanID(t *testing.T) {
	var buf bytes.Buffer
	logger := slog.New(telemetry.NewTraceHandler(slog.NewJSONHandler(&buf, nil)))

	ctx, wantTrace, wantSpan := startSpan(t)
	logger.InfoContext(ctx, "hello")

	got := logLine(t, &buf)
	if got["trace_id"] != wantTrace {
		t.Errorf("trace_id = %v, want %v", got["trace_id"], wantTrace)
	}
	if got["span_id"] != wantSpan {
		t.Errorf("span_id = %v, want %v", got["span_id"], wantSpan)
	}
}

// Regression guard: a decorator that embeds slog.Handler without overriding
// WithAttrs returns the *inner* handler, silently dropping trace stamping for
// any logger built with .With(...).
func TestHandlerSurvivesWithAttrsAndWithGroup(t *testing.T) {
	var buf bytes.Buffer
	logger := slog.New(telemetry.NewTraceHandler(slog.NewJSONHandler(&buf, nil))).
		With("component", "test")

	ctx, wantTrace, _ := startSpan(t)
	logger.InfoContext(ctx, "hello")

	got := logLine(t, &buf)
	if got["trace_id"] != wantTrace {
		t.Errorf("trace_id = %v after With(), want %v", got["trace_id"], wantTrace)
	}
	if got["component"] != "test" {
		t.Errorf("component = %v, want test", got["component"])
	}
}

// No span in context is the normal case for startup/shutdown logs. It must not
// panic and must not emit empty-string ids.
func TestHandlerOmitsIDsWithoutSpan(t *testing.T) {
	var buf bytes.Buffer
	logger := slog.New(telemetry.NewTraceHandler(slog.NewJSONHandler(&buf, nil)))

	logger.InfoContext(context.Background(), "no span here")

	got := logLine(t, &buf)
	if _, ok := got["trace_id"]; ok {
		t.Errorf("trace_id present without a span: %v", got["trace_id"])
	}
	if got["msg"] != "no span here" {
		t.Errorf("msg = %v, want %q", got["msg"], "no span here")
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `go test ./internal/telemetry/ -run TestHandler -v`
Expected: FAIL — build error, `undefined: telemetry.NewTraceHandler`.

- [ ] **Step 3: Write the implementation**

Create `internal/telemetry/log.go`:

```go
package telemetry

import (
	"context"
	"log/slog"

	"go.opentelemetry.io/otel/trace"
)

// traceHandler decorates a slog.Handler, stamping the active trace and span id
// onto every record. This is what makes Loki ↔ Tempo navigation work: Grafana
// pivots from a log line to its trace using these exact field names.
type traceHandler struct {
	inner slog.Handler
}

// NewTraceHandler wraps inner so records logged with a context carrying a valid
// span gain trace_id and span_id attributes. Records without a span are passed
// through unchanged.
func NewTraceHandler(inner slog.Handler) slog.Handler {
	return traceHandler{inner: inner}
}

func (h traceHandler) Enabled(ctx context.Context, level slog.Level) bool {
	return h.inner.Enabled(ctx, level)
}

func (h traceHandler) Handle(ctx context.Context, rec slog.Record) error {
	if sc := trace.SpanContextFromContext(ctx); sc.IsValid() {
		rec.AddAttrs(
			slog.String("trace_id", sc.TraceID().String()),
			slog.String("span_id", sc.SpanID().String()),
		)
	}
	return h.inner.Handle(ctx, rec)
}

// WithAttrs and WithGroup must re-wrap. Returning h.inner.WithAttrs(...)
// directly — which is what embedding slog.Handler would do by default — would
// silently strip trace stamping from any logger built with .With(...).
func (h traceHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return traceHandler{inner: h.inner.WithAttrs(attrs)}
}

func (h traceHandler) WithGroup(name string) slog.Handler {
	return traceHandler{inner: h.inner.WithGroup(name)}
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `go test ./internal/telemetry/ -v`
Expected: PASS — all five tests in the package.

- [ ] **Step 5: Lint and commit**

```bash
golangci-lint run ./internal/telemetry/...
git add internal/telemetry/
git commit -m "feat(recipe-service): add trace-stamping slog handler"
```

---

### Task 3: Wire slog and telemetry lifecycle into the server

**Files:**
- Modify: `apps/recipe-service/cmd/server/main.go` (whole file — replacement given below)
- Modify: `apps/recipe-service/cmd/seed/main.go` (import swap only)

**Interfaces:**
- Consumes: `telemetry.Init(ctx, serviceName) (func(context.Context) error, error)` and `telemetry.NewTraceHandler(slog.Handler) slog.Handler` from Tasks 1–2.
- Produces: a process-wide `slog` default logger emitting JSON to stdout with trace stamping. Later tasks call `slog.ErrorContext(ctx, ...)` and rely on that default being installed.

**Note on ordering:** `telemetry.Init` must run *before* the store is created, so that Task 6's `otelpgx` tracer has a real provider installed when the pool is built.

- [ ] **Step 1: Replace `cmd/server/main.go`**

```go
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"pantry/apps/recipe-service/internal/recipe"
	"pantry/apps/recipe-service/internal/telemetry"
)

func main() {
	if err := run(); err != nil {
		slog.Error("fatal", "err", err)
		os.Exit(1)
	}
}

func run() error {
	// JSON to stdout: the container runtime collects it, and Alloy ships it to
	// Loki. Trace stamping makes each line pivot to its trace in Tempo.
	slog.SetDefault(slog.New(telemetry.NewTraceHandler(
		slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}),
	)))

	port := os.Getenv("PORT")
	if port == "" {
		port = "8090"
	}

	// Init before the store so the pgx tracer (BL-0027) sees a real provider.
	shutdownTelemetry, err := telemetry.Init(context.Background(), "recipe-service")
	if err != nil {
		// Telemetry must never stop the service from serving traffic.
		slog.Warn("telemetry disabled", "err", err)
	}
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := shutdownTelemetry(ctx); err != nil {
			slog.Warn("telemetry shutdown", "err", err)
		}
	}()

	var store recipe.Store
	if dsn := os.Getenv("DATABASE_URL"); dsn != "" {
		pg, err := recipe.NewPostgresStore(context.Background(), dsn)
		if err != nil {
			return fmt.Errorf("postgres: %w", err)
		}
		defer pg.Close()
		store = pg
		slog.Info("store selected", "kind", "postgres")
	} else {
		store = recipe.NewMemoryStore()
		slog.Info("store selected", "kind", "memory", "reason", "DATABASE_URL unset")
	}

	secret := os.Getenv("RECIPE_SERVICE_SECRET")
	if secret == "" {
		return errors.New("RECIPE_SERVICE_SECRET is required")
	}

	var extractor recipe.Extractor
	if apiKey := os.Getenv("ANTHROPIC_API_KEY"); apiKey != "" {
		extractor = recipe.NewClaudeExtractor(apiKey)
		slog.Info("recipe import: LLM fallback enabled")
	} else {
		slog.Info("recipe import: LLM fallback disabled", "reason", "ANTHROPIC_API_KEY unset")
	}
	importer := recipe.NewImporter(recipe.NewHTTPFetcher(), extractor)
	handler := recipe.NewRouterWithImporter(store, secret, importer)

	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	// Stop trapping the interrupt signals once we begin shutting down, so a
	// second Ctrl-C / SIGTERM force-quits instead of being swallowed.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	serverErr := make(chan error, 1)
	go func() {
		slog.Info("recipe-service listening", "port", port)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serverErr <- err
		}
	}()

	select {
	case err := <-serverErr:
		return fmt.Errorf("server: %w", err)
	case <-ctx.Done():
		stop()
		slog.Info("shutdown signal received; draining connections")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := srv.Shutdown(shutdownCtx); err != nil {
			return fmt.Errorf("graceful shutdown: %w", err)
		}
		slog.Info("shutdown complete")
		return nil
	}
}
```

- [ ] **Step 2: Swap stdlib `log` for `slog` in the seeder**

In `cmd/seed/main.go`, change the import `"log"` to `"log/slog"`, then replace each call:
- `log.Fatal(err)` → `slog.Error("fatal", "err", err); os.Exit(1)` (add `"os"` to imports if absent)
- `log.Printf(format, args...)` → `slog.Info("<short message>", "<key>", value)` — convert the format string into a message plus key/value pairs rather than pre-formatting it.

Run `go build ./cmd/seed/` after editing to confirm no unused imports remain.

- [ ] **Step 3: Verify the whole module builds and tests pass**

Run: `go build ./... && go test ./... 2>&1 | tail -20`
Expected: build succeeds; all existing packages report `ok` or `no test files`.

- [ ] **Step 4: Verify the no-op path by running the server**

```bash
RECIPE_SERVICE_SECRET=dev go run ./cmd/server &
sleep 1
curl -s localhost:8090/healthz
kill %1
```

Expected: the startup lines are now JSON (`{"time":...,"level":"INFO","msg":"recipe-service listening","port":"8090"}`), `curl` returns `{"status":"ok"}`, and **no OTLP connection errors appear** because `OTEL_EXPORTER_OTLP_ENDPOINT` is unset.

- [ ] **Step 5: Lint and commit**

```bash
golangci-lint run ./...
git add cmd/
git commit -m "refactor(recipe-service): replace stdlib log with structured slog"
```

---

### Task 4: Trace HTTP requests with `otelhttp`

**Files:**
- Modify: `apps/recipe-service/internal/recipe/handler.go:14-33` (router construction)
- Create: `apps/recipe-service/internal/recipe/telemetry_test.go`

**Interfaces:**
- Consumes: the global tracer provider installed by `telemetry.Init` (Task 1). Tests install their own provider instead.
- Produces: every request produces a server span named after its route pattern (e.g. `GET /recipes/{id}`), with `http.route` set. Task 5 attaches error status to these spans.

**Two decisions worth understanding before editing:**

1. **`otelhttp` wraps `requireService`, not the other way round.** The design calls for auth failures to be traced — if `otelhttp` were inside, a 401 would produce no span at all, and "why are requests failing?" is exactly when you need the trace.
2. **Span names come from `r.Pattern`, set by `ServeMux` during routing.** `otelhttp` runs *before* routing, so it cannot know the route; naming spans from the raw path would put ids like `/recipes/abc123` into span names and explode cardinality. The `traced` helper below renames the span from inside the matched handler, where `r.Pattern` is populated.

- [ ] **Step 1: Write the failing test**

Create `internal/recipe/telemetry_test.go`:

```go
package recipe

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"go.opentelemetry.io/otel"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.opentelemetry.io/otel/trace/noop"
)

// withRecordedSpans installs a synchronous in-memory tracer provider and
// returns the exporter holding whatever spans the test produces.
func withRecordedSpans(t *testing.T) *tracetest.InMemoryExporter {
	t.Helper()
	exp := tracetest.NewInMemoryExporter()
	tp := sdktrace.NewTracerProvider(sdktrace.WithSyncer(exp))
	otel.SetTracerProvider(tp)
	t.Cleanup(func() { otel.SetTracerProvider(noop.NewTracerProvider()) })
	return exp
}

func TestRouterNamesSpansAfterRoutePattern(t *testing.T) {
	exp := withRecordedSpans(t)

	srv := httptest.NewServer(NewRouter(NewMemoryStore(), "s3cret"))
	defer srv.Close()

	req, err := http.NewRequest(http.MethodGet, srv.URL+"/recipes", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("X-Service-Secret", "s3cret")
	req.Header.Set("X-User-Id", "user-1")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	spans := exp.GetSpans()
	if len(spans) == 0 {
		t.Fatal("no spans recorded for a routed request")
	}
	if got := spans[0].Name; got != "GET /recipes" {
		t.Errorf("span name = %q, want %q", got, "GET /recipes")
	}
}

// A 401 never reaches the mux, so this only passes if otelhttp wraps
// requireService rather than sitting inside it.
func TestRouterTracesAuthFailures(t *testing.T) {
	exp := withRecordedSpans(t)

	srv := httptest.NewServer(NewRouter(NewMemoryStore(), "s3cret"))
	defer srv.Close()

	req, err := http.NewRequest(http.MethodGet, srv.URL+"/recipes", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("X-Service-Secret", "wrong")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", resp.StatusCode)
	}
	if len(exp.GetSpans()) == 0 {
		t.Fatal("no span recorded for a rejected request; is otelhttp inside requireService?")
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `go test ./internal/recipe/ -run TestRouter -v`
Expected: FAIL — `no spans recorded for a routed request` (the router has no instrumentation yet).

- [ ] **Step 3: Add the dependency if `go mod tidy` dropped it**

```bash
go get go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp
go get go.opentelemetry.io/otel/sdk/trace/tracetest
go mod tidy
```

- [ ] **Step 4: Rewrite the router construction**

In `internal/recipe/handler.go`, replace lines 14–33 (`NewRouter` through the end of `NewRouterWithImporter`) with:

```go
func NewRouter(store Store, secret string) http.Handler {
	return NewRouterWithImporter(store, secret, nil)
}

// traced renames the active server span to the matched route pattern. otelhttp
// wraps the router before ServeMux has matched anything, so r.Pattern — which
// the mux fills in during routing — is only available here, inside the handler.
// Naming spans from the raw path instead would put recipe ids into span names
// and blow up cardinality in Tempo.
func traced(fn http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if span := trace.SpanFromContext(r.Context()); span.IsRecording() && r.Pattern != "" {
			span.SetName(r.Pattern)
			span.SetAttributes(semconv.HTTPRoute(r.Pattern))
		}
		fn(w, r)
	}
}

// NewRouterWithImporter is NewRouter plus URL import. imp may be nil, in which
// case POST /recipes/import responds 503 (import not configured).
func NewRouterWithImporter(store Store, secret string, imp *Importer) http.Handler {
	h := &handlers{store: store, importer: imp}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", traced(h.healthz))
	mux.HandleFunc("POST /recipes", traced(h.createRecipe))
	mux.HandleFunc("GET /recipes", traced(h.listRecipes))
	mux.HandleFunc("GET /recipes/{id}", traced(h.getRecipe))
	mux.HandleFunc("GET /catalog", traced(h.listCatalog))
	mux.HandleFunc("DELETE /recipes/{id}", traced(h.deleteRecipe))
	mux.HandleFunc("PUT /recipes/{id}", traced(h.updateRecipe))
	mux.HandleFunc("POST /recipes/import", traced(h.importRecipe))
	mux.HandleFunc("POST /grocery-list", traced(h.groceryList))

	// otelhttp sits OUTSIDE requireService so rejected requests are traced too —
	// an auth failure is precisely when you want to see the request.
	return otelhttp.NewHandler(requireService(secret, mux), "recipe-service")
}
```

- [ ] **Step 5: Update the imports in `handler.go`**

The import block at the top of `internal/recipe/handler.go` becomes:

```go
import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
	"go.opentelemetry.io/otel/trace"
)
```

Then fix the one existing stdlib `log` call at `handler.go:226`, which the import swap breaks:

```go
		slog.WarnContext(r.Context(), "grocery-list: skipped unresolvable recipe ids",
			"count", len(skipped), "ids", skipped)
```

> This call sits inside `groceryList` (`handler.go:162`), whose signature is `func (h *handlers) groceryList(w http.ResponseWriter, r *http.Request)`, so `r.Context()` is in scope and compiles as written.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `go test ./internal/recipe/ -run TestRouter -v`
Expected: PASS — both tests.

- [ ] **Step 7: Run the full suite to catch regressions**

Run: `go test ./... 2>&1 | tail -20`
Expected: all packages `ok`. The existing `handler_test.go` and `middleware_test.go` exercise the router heavily; they must still pass unchanged.

- [ ] **Step 8: Lint and commit**

```bash
golangci-lint run ./...
git add internal/recipe/ go.mod go.sum
git commit -m "feat(recipe-service): trace HTTP requests with otelhttp"
```

---

### Task 5: Record errors on spans and logs

**Files:**
- Modify: `apps/recipe-service/internal/recipe/handler.go` (23 `writeError` call sites + the definition at :253)
- Modify: `apps/recipe-service/internal/recipe/middleware.go:32,37`
- Modify: `apps/recipe-service/internal/recipe/telemetry_test.go` (add one test)

**Interfaces:**
- Consumes: the span produced in Task 4; the default `slog` logger installed in Task 3.
- Produces: `writeError(w http.ResponseWriter, r *http.Request, status int, msg string)` and `writeErr(w http.ResponseWriter, r *http.Request, status int, msg string, err error)`. Every non-2xx response now carries a log line, and 5xx additionally marks its span `codes.Error`.

**This task is the point of the whole PR.** Today a failed recipe write produces `writeError(w, 500, "could not create recipe")` and *nothing else* — the underlying error is discarded, unlogged. After this task, every 500 has the cause in a log line correlated to a trace.

- [ ] **Step 1: Write the failing test**

Append to `internal/recipe/telemetry_test.go`:

```go
// failingStore makes CreateRecipe return an error so we can assert the 500 path
// records something instead of silently swallowing the cause.
type failingStore struct {
	Store
}

func (failingStore) CreateRecipe(context.Context, string, string, []Ingredient) (Recipe, error) {
	return Recipe{}, errors.New("boom")
}

func TestServerErrorMarksSpanAsError(t *testing.T) {
	exp := withRecordedSpans(t)

	srv := httptest.NewServer(NewRouter(failingStore{Store: NewMemoryStore()}, "s3cret"))
	defer srv.Close()

	req, err := http.NewRequest(http.MethodPost, srv.URL+"/recipes",
		strings.NewReader(`{"title":"Soup","ingredients":[]}`))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("X-Service-Secret", "s3cret")
	req.Header.Set("X-User-Id", "user-1")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", resp.StatusCode)
	}

	spans := exp.GetSpans()
	if len(spans) == 0 {
		t.Fatal("no spans recorded")
	}
	if got := spans[0].Status.Code; got != codes.Error {
		t.Errorf("span status = %v, want %v", got, codes.Error)
	}
	if len(spans[0].Events) == 0 {
		t.Error("no exception event recorded on the failing span")
	}
}
```

Add to that file's imports: `"context"`, `"errors"`, `"strings"`, and `"go.opentelemetry.io/otel/codes"`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `go test ./internal/recipe/ -run TestServerErrorMarksSpan -v`
Expected: FAIL — `span status = Unset, want Error`, or a build error about `failingStore` if the `Store` interface method set differs (embedding `Store` supplies the rest).

- [ ] **Step 3: Replace the `writeError` definition**

In `internal/recipe/handler.go`, replace lines 253–255 with:

```go
// writeError responds with a JSON error and records it. 5xx marks the span as
// failed so Tempo surfaces it; 4xx logs at warn level because it is usually a
// client mistake, not our bug.
func writeError(w http.ResponseWriter, r *http.Request, status int, msg string) {
	writeErr(w, r, status, msg, nil)
}

// writeErr is writeError plus the underlying cause. Use it wherever an error
// value is in scope — before BL-0027 those causes were discarded entirely.
func writeErr(w http.ResponseWriter, r *http.Request, status int, msg string, cause error) {
	ctx := r.Context()

	attrs := []any{"status", status, "path", r.URL.Path, "method", r.Method}
	if cause != nil {
		attrs = append(attrs, "err", cause)
	}

	if status >= http.StatusInternalServerError {
		span := trace.SpanFromContext(ctx)
		span.SetStatus(codes.Error, msg)
		if cause != nil {
			span.RecordError(cause)
		} else {
			span.RecordError(errors.New(msg))
		}
		slog.ErrorContext(ctx, msg, attrs...)
	} else {
		slog.WarnContext(ctx, msg, attrs...)
	}

	writeJSON(w, status, map[string]string{"error": msg})
}
```

Add `"go.opentelemetry.io/otel/codes"` to the `handler.go` import block.

- [ ] **Step 4: Update all call sites mechanically**

```bash
cd apps/recipe-service
sed -i '' 's/writeError(w, http\./writeError(w, r, http./g' internal/recipe/handler.go internal/recipe/middleware.go
go build ./... 2>&1 | head -20
```

Expected: the build reports errors **only** at sites where the local variable is not named `r`. Fix each by passing the request variable actually in scope. In `decodeJSON` (`handler.go:233-245`) the parameter is already `r`, so those two sites compile as-is.

- [ ] **Step 5: Upgrade the 500 sites to carry their cause**

For each site listed below, the enclosing block already has an `err` in scope that is currently discarded. Change `writeError(w, r, http.StatusInternalServerError, "<msg>")` to `writeErr(w, r, http.StatusInternalServerError, "<msg>", err)`:

| Line (pre-edit) | Message |
|---|---|
| `handler.go:58` | `could not create recipe` |
| `handler.go:67` | `could not list recipes` |
| `handler.go:76` | `could not list catalog` |
| `handler.go:89` | `could not get recipe` |
| `handler.go:102` | `could not delete recipe` |
| `handler.go:126` | `could not update recipe` |
| `handler.go:156` | `could not import recipe` |
| `handler.go:183` | `could not load recipes` |
| `handler.go:206` | `could not load catalog recipes` |

Also upgrade the two non-500 import failures at `handler.go:152` (`could not fetch the url`) and `handler.go:154` (`could not extract a recipe from this page; enter it manually`) to `writeErr(..., err)` — they are the most common real-world failures and their causes are worth logging even at 4xx/5xx boundaries.

> If the variable at a given site is named something other than `err` (for example `ierr`), pass that name instead. Run `go build ./...` after this step; it will name any site you missed.

- [ ] **Step 6: Run the tests**

Run: `go test ./internal/recipe/ -v 2>&1 | tail -30`
Expected: PASS, including the new `TestServerErrorMarksSpanAsError` and every pre-existing handler/middleware test.

- [ ] **Step 7: Lint and commit**

```bash
golangci-lint run ./...
git add internal/recipe/
git commit -m "feat(recipe-service): record handler errors on spans and structured logs"
```

---

### Task 6: Trace database calls with `otelpgx`

**Files:**
- Modify: `apps/recipe-service/internal/recipe/postgres.go:21-31`
- Modify: `apps/recipe-service/go.mod`, `go.sum`

**Interfaces:**
- Consumes: the global tracer provider from Task 1.
- Produces: pgx query spans as children of the HTTP server span. No signature changes — `NewPostgresStore(ctx, dsn)` keeps its exact shape, so no callers or tests change.

- [ ] **Step 1: Add the dependency**

```bash
go get github.com/exaring/otelpgx
go mod tidy
```

- [ ] **Step 2: Rewrite the constructor**

Replace `internal/recipe/postgres.go:21-31` with:

```go
func NewPostgresStore(ctx context.Context, dsn string) (*PostgresStore, error) {
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, fmt.Errorf("parse dsn: %w", err)
	}
	// Query spans become children of the HTTP server span, so a slow endpoint
	// shows exactly which statement cost the time. When no tracer provider is
	// installed this resolves to the OTel no-op and costs nothing.
	cfg.ConnConfig.Tracer = otelpgx.NewTracer()

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("connect pool: %w", err)
	}
	if _, err := pool.Exec(ctx, schemaSQL); err != nil {
		pool.Close()
		return nil, fmt.Errorf("apply schema: %w", err)
	}
	return &PostgresStore{pool: pool}, nil
}
```

Add `"github.com/exaring/otelpgx"` to the `postgres.go` import block.

- [ ] **Step 3: Verify the build and the Postgres-backed tests**

Run: `go build ./... && go test ./internal/recipe/ -run TestPostgres -v 2>&1 | tail -20`

Expected: `SKIP` with `set PANTRY_TEST_DATABASE_URL to run Postgres integration tests` — `postgres_test.go` guards on that variable, **not** `DATABASE_URL`. To actually exercise the traced pool, start the database and set it:

```bash
docker compose up -d postgres
PANTRY_TEST_DATABASE_URL='postgres://pantry:pantry@localhost:5433/pantry?sslmode=disable' \
  go test ./internal/recipe/ -run TestPostgres -v 2>&1 | tail -20
```

Note the host port is **5433**, not 5432 — `docker-compose.yml:12` remaps it because 5432 is commonly occupied by a local Postgres.

Expected: PASS. This proves `pgxpool.NewWithConfig` still connects and applies the schema after the constructor rewrite — the one real regression risk in this task.

- [ ] **Step 4: Lint and commit**

```bash
golangci-lint run ./...
git add internal/recipe/postgres.go go.mod go.sum
git commit -m "feat(recipe-service): trace pgx queries with otelpgx"
```

---

### Task 7: Alloy + LGTM compose services

**Files:**
- Create: `alloy/config.alloy` (repo root)
- Modify: `docker-compose.yml` (repo root)
- Modify: `.env.example` (repo root)

**Interfaces:**
- Consumes: nothing from the Go tasks — this is infrastructure and can be verified independently.
- Produces: an OTLP endpoint at `http://alloy:4318` (in-network) / `http://localhost:4318` (host), a Grafana UI on `http://localhost:3001`, and an Alloy pipeline UI on `http://localhost:12345`. PR 2 and PR 3 both target this same endpoint.

- [ ] **Step 1: Create the Alloy pipeline config**

Create `alloy/config.alloy` at the repo root:

```alloy
// OTLP in from three runtimes: the Go recipe-service (gRPC), the browser and
// Convex actions (HTTP). CORS is declared here because the browser posts
// directly to this endpoint — the LGTM container should never be exposed to it.
otelcol.receiver.otlp "default" {
  grpc {
    endpoint = "0.0.0.0:4317"
  }

  http {
    endpoint = "0.0.0.0:4318"
    cors {
      allowed_origins = ["http://localhost:5173", "http://127.0.0.1:5173"]
      allowed_headers = ["*"]
    }
  }

  output {
    traces = [otelcol.processor.attributes.scrub.input]
    logs   = [otelcol.processor.attributes.scrub.input]
  }
}

// PII scrubbing lives in the pipeline, not in application code, so it cannot be
// forgotten at an individual call site.
otelcol.processor.attributes "scrub" {
  action {
    key    = "user.email"
    action = "delete"
  }

  action {
    key    = "user.id"
    action = "hash"
  }

  output {
    traces = [otelcol.processor.batch.default.input]
    logs   = [otelcol.processor.batch.default.input]
  }
}

otelcol.processor.batch "default" {
  output {
    traces = [otelcol.exporter.otlp.lgtm.input]
    logs   = [otelcol.exporter.otlp.lgtm.input]
  }
}

// The one line that changes when production lands (BL-0006). Nothing in
// application code ever names Grafana.
otelcol.exporter.otlp "lgtm" {
  client {
    endpoint = "otel-lgtm:4317"
    tls {
      insecure = true
    }
  }
}
```

- [ ] **Step 2: Resolve image digests**

Following the BL-0008 pinning discipline:

```bash
docker pull grafana/alloy:latest
docker image inspect grafana/alloy:latest --format '{{index .RepoDigests 0}}'
docker pull grafana/otel-lgtm:latest
docker image inspect grafana/otel-lgtm:latest --format '{{index .RepoDigests 0}}'
```

Copy both `name@sha256:...` strings into the compose block in the next step, replacing the `image:` values.

- [ ] **Step 3: Add the compose services**

Append to the `services:` map in `docker-compose.yml` (both behind `profiles: [obs]`, so `docker compose up` is unchanged and CI never pulls them):

```yaml
  # Observability (BL-0027). Opt in with: docker compose --profile obs up
  # Pinned by digest per BL-0008. To bump: pull :latest and re-read the digest.
  alloy:
    image: grafana/alloy@sha256:REPLACE_WITH_DIGEST_FROM_STEP_2
    command:
      - run
      - --server.http.listen-addr=0.0.0.0:12345
      - --storage.path=/var/lib/alloy/data
      - /etc/alloy/config.alloy
    volumes:
      - ./alloy/config.alloy:/etc/alloy/config.alloy:ro
    ports:
      - "4317:4317"   # OTLP gRPC  (recipe-service)
      - "4318:4318"   # OTLP HTTP  (browser, Convex)
      - "12345:12345" # Alloy pipeline UI
    depends_on:
      - otel-lgtm
    profiles: [obs]

  otel-lgtm:
    image: grafana/otel-lgtm@sha256:REPLACE_WITH_DIGEST_FROM_STEP_2
    ports:
      # 3001 on the host: 3000 is a common dev-server default and this is the
      # container we least want to fight over a port with.
      - "3001:3000"
    profiles: [obs]
```

- [ ] **Step 4: Let recipe-service opt in without depending on the stack**

In the `recipe-service` service's `environment:` map in `docker-compose.yml`, add:

```yaml
      # Unset by default: telemetry is a no-op without it, so the plain
      # `docker compose up` stack and CI never try to reach a collector.
      OTEL_EXPORTER_OTLP_ENDPOINT: ${OTEL_EXPORTER_OTLP_ENDPOINT:-}
      OTEL_SERVICE_NAME: recipe-service
```

Add to `.env.example`:

```bash
# Observability (BL-0027). Set this and run `docker compose --profile obs up`
# to send traces to the local Grafana stack. Leave unset for a quiet stack.
# OTEL_EXPORTER_OTLP_ENDPOINT=http://alloy:4318
```

- [ ] **Step 5: Verify compose config parses and the default stack is unchanged**

```bash
docker compose config --quiet && echo "compose OK"
docker compose config --services
docker compose --profile obs config --services
```

Expected: `compose OK`; the first service list does **not** contain `alloy` or `otel-lgtm`; the second does.

- [ ] **Step 6: Bring up the observability stack and confirm it is healthy**

```bash
docker compose --profile obs up -d alloy otel-lgtm
sleep 20
curl -sf localhost:12345/-/ready && echo "alloy ready"
curl -sf -o /dev/null -w '%{http_code}\n' localhost:3001
```

Expected: `alloy ready`, and `200` from Grafana. If Alloy is not ready, read its logs (`docker compose logs alloy`) — a config syntax error surfaces there and at `http://localhost:12345`.

- [ ] **Step 7: Commit**

```bash
git add alloy/ docker-compose.yml .env.example
git commit -m "feat(infra): add Grafana Alloy + otel-lgtm behind the obs compose profile"
```

---

### Task 8: End-to-end verification and documentation

**Files:**
- Modify: `README.md` (repo root)
- Modify: `docs/backlog/BL-0027-observability-telemetry.md`

**Interfaces:**
- Consumes: everything from Tasks 1–7.
- Produces: the documented workflow PR 2 (Convex) and PR 3 (web) will point their SDKs at.

- [ ] **Step 1: Run the full stack and generate a traced request**

```bash
docker compose --profile obs up -d --build
sleep 25
curl -s -X POST localhost:8090/recipes \
  -H 'X-Service-Secret: '"$RECIPE_SERVICE_SECRET" \
  -H 'X-User-Id: verify-user' \
  -H 'Content-Type: application/json' \
  -d '{"title":"Trace Test Soup","ingredients":[{"name":"water","quantity":1,"unit":"cup"}]}'
```

Expected: a JSON recipe body with an `id`.

> If `OTEL_EXPORTER_OTLP_ENDPOINT` is not exported in your shell, prefix the compose command with `OTEL_EXPORTER_OTLP_ENDPOINT=http://alloy:4318`, otherwise the service starts in no-op mode and no spans are produced.

- [ ] **Step 2: Confirm the trace arrived**

Open `http://localhost:3001` → Explore → Tempo → Search. Confirm you see a trace named `POST /recipes` containing a **child span for the Postgres INSERT**.

If nothing appears, check in this order — it is almost always the first one:
1. `docker compose logs recipe-service | head -20` — is `OTEL_EXPORTER_OTLP_ENDPOINT` actually set in the container? (`docker compose exec recipe-service env | grep OTEL`)
2. `http://localhost:12345` — Alloy's pipeline UI shows whether spans are arriving and where they are being dropped.
3. `docker compose logs alloy` — export errors to LGTM surface here.

- [ ] **Step 3: Confirm log/trace correlation**

```bash
docker compose logs recipe-service | grep trace_id | tail -3
```

Expected: JSON log lines carrying `trace_id` and `span_id`. Copy one `trace_id` and paste it into Tempo's search-by-id box — it must resolve to the trace from Step 2. **This bidirectional link is the deliverable of the whole PR**; if it does not work, the `slog` handler is not receiving a request context somewhere.

- [ ] **Step 4: Confirm the error path**

```bash
curl -s -o /dev/null -w '%{http_code}\n' localhost:8090/recipes -H 'X-Service-Secret: wrong'
docker compose logs recipe-service | tail -3
```

Expected: `401`, and a warn-level JSON log line for the rejected request. Confirm in Tempo that a span exists for it — this is the auth-failure tracing that motivated putting `otelhttp` outside `requireService`.

- [ ] **Step 5: Confirm the no-op path still works (the CI contract)**

```bash
docker compose --profile obs down
OTEL_EXPORTER_OTLP_ENDPOINT= docker compose up -d --build recipe-service postgres
sleep 10
curl -s localhost:8090/healthz
docker compose logs recipe-service | grep -ci 'otlp\|connection refused\|export' || echo "0 exporter complaints"
```

Expected: `{"status":"ok"}` and **zero** exporter complaints. This is the Global Constraint that keeps CI green — do not skip it.

- [ ] **Step 6: Run the full test suite one final time**

```bash
cd apps/recipe-service && go test -race -cover ./... 2>&1 | tail -20
golangci-lint run ./...
gofmt -l . && go vet ./...
```

Expected: all packages `ok` with coverage reported, no lint output, no `gofmt` output.

- [ ] **Step 7: Document the workflow in `README.md`**

Add a section after the existing Testing sections:

````markdown
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

Telemetry is a **complete no-op when `OTEL_EXPORTER_OTLP_ENDPOINT` is unset**, so
CI and the plain compose stack are unaffected. Log lines carry `trace_id` and
`span_id`, so you can pivot from any log line to its trace and back.
````

- [ ] **Step 8: Update the backlog item**

In `docs/backlog/BL-0027-observability-telemetry.md`, change the PR-1 bullet under `## Proposal` to note it has landed, and leave `status: proposed` until PR 3 completes the item (per `CLAUDE.md`, `status: done` is set in the finishing changeset).

- [ ] **Step 9: Commit and open the PR**

```bash
git add README.md docs/backlog/BL-0027-observability-telemetry.md
git commit -m "docs: document the observability stack workflow"
git push -u origin HEAD
gh pr create --title "BL-0027 PR 1: observability foundation + Go instrumentation" --body "..."
```

Open it **ready for review, not as a draft** (`CLAUDE.md`).

---

## Self-Review

**Spec coverage.** Checked each spec section against a task:

| Spec requirement | Task |
|---|---|
| Alloy collector, config, CORS, PII scrub | 7 |
| `grafana/otel-lgtm` backend | 7 |
| `internal/telemetry` — `Init(ctx) (shutdown, err)` | 1 |
| `internal/telemetry` — trace-stamping `slog.Handler` | 2 |
| `otelhttp` outside `requireService` | 4 |
| `otelpgx` on the pool | 6 |
| stdlib `log` → `slog` | 3 |
| Spans marked `StatusError`, exceptions recorded | 5 |
| No-op when `OTEL_EXPORTER_OTLP_ENDPOINT` unset | 1 (implementation), 8 step 5 (verification) |
| `profiles: [obs]`, CI untouched | 7 |
| Go tests: slog stamping, span error status | 2, 5 |
| Image pinning by digest (BL-0008 discipline) | 7 step 2 |

Not in this plan, by design: Convex spans and `traceparent` propagation (PR 2), browser RUM and the error boundary (PR 3), metrics/alerting/sampling (out of scope per spec), production export destination (BL-0006).

**Type consistency.** `Init` returns `(func(context.Context) error, error)` in Task 1 and is consumed with that exact shape in Task 3. `NewTraceHandler(slog.Handler) slog.Handler` is defined in Task 2 and used identically in Task 3. `writeError` gains `r *http.Request` as its second parameter in Task 5, and every call site is updated in the same task. `NewPostgresStore`'s signature is unchanged in Task 6, so no other file needs edits.

**Known follow-ups deliberately left open:** the spec's open question about whether `otel-lgtm` data should persist to `./.data/lgtm` is resolved here as *ephemeral* (no volume in Task 7), which avoids gitignore churn and is appropriate for local dev.
