import { SpanStatusCode, trace } from "@opentelemetry/api";
import { Component, type ErrorInfo, type ReactNode } from "react";

const tracer = trace.getTracer("pantry-web");

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
}

// App-wide error boundary (the app had none). Renders a fallback instead of a
// blank screen and records the crash as a span so it reaches the trace backend.
// When telemetry is disabled the tracer is a no-op, so this just logs.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const span = tracer.startSpan("web.error_boundary");
    span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
    span.recordException(error);
    span.setAttribute("react.component_stack", info.componentStack ?? "");
    span.end();
    console.error(error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return this.props.fallback ?? <div role="alert">Something went wrong.</div>;
    }
    return this.props.children;
  }
}
