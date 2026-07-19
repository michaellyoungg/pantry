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

	// Schemaless: resource.Default() already carries a schema URL (from the
	// SDK's own semconv version), and resource.Merge refuses to merge two
	// resources whose non-empty schema URLs differ. Since we pin a different
	// semconv version for ServiceName below, giving this resource its own
	// schema URL would make every merge fail.
	res, err := resource.Merge(
		resource.Default(),
		resource.NewSchemaless(semconv.ServiceName(serviceName)),
	)
	if err != nil {
		_ = exporter.Shutdown(ctx)
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
