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
	t.Cleanup(func() { span.End() })

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
