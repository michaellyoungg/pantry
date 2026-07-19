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

// With a syntactically valid endpoint, Init must actually succeed: the
// exporter, resource merge, and tracer-provider wiring must all complete
// without error. otlptracehttp.New does not dial synchronously, so this does
// not require a running collector.
func TestInitWithValidEndpointSucceeds(t *testing.T) {
	t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4318")

	shutdown, err := telemetry.Init(context.Background(), "test-service")
	if err != nil {
		t.Fatalf("Init() error = %v, want nil", err)
	}
	if shutdown == nil {
		t.Fatal("Init() shutdown = nil, want a callable shutdown func")
	}
	if err := shutdown(context.Background()); err != nil {
		t.Fatalf("shutdown() error = %v, want nil", err)
	}
}
