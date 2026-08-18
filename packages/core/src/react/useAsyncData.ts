import { useCallback, useEffect, useState } from "react";
import { errorMessage } from "./useAsyncAction";

/**
 * Read-side analog of useAsyncAction: runs an imperative async load (a Convex
 * action / fetch) and tracks loading / data / error so callers can render the
 * three states distinctly instead of collapsing them. `reload()` re-runs `fn`
 * (e.g. from a Retry button or after a mutation). Re-runs when `fn` identity or
 * any `deps` entry changes; a result that settles after unmount is ignored.
 */
export function useAsyncData<T>(
  fn: () => Promise<T>,
  deps: unknown[] = [],
): { data: T | undefined; loading: boolean; error: string | null; reload: () => void } {
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    fn()
      .then((r) => {
        if (!active) return;
        setData(r);
        setLoading(false);
      })
      .catch((e) => {
        if (!active) return;
        setError(errorMessage(e));
        setLoading(false);
      });
    return () => {
      active = false;
    };
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- caller-supplied deps are intentionally spread
  }, [fn, nonce, ...deps]);

  return { data, loading, error, reload };
}
