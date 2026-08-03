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
