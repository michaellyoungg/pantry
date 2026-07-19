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
