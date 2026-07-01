import { useCallback, useState } from "react";

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function useAsyncAction() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const run = useCallback(async <T>(fn: () => Promise<T>): Promise<T | undefined> => {
    setPending(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(errorMessage(e));
      return undefined;
    } finally {
      setPending(false);
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  // Surface a message directly, e.g. for a best-effort secondary step that
  // failed after a primary op already succeeded (so it can't go through `run`).
  const showError = useCallback((message: string) => setError(message), []);

  return { run, error, pending, clearError, showError };
}
