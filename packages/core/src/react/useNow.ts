import { useEffect, useState } from "react";

// The react layer compiles without DOM or Node types. Both clients provide
// these, and declaring them here keeps them out of the rest of the package.
declare function setInterval(handler: () => void, ms: number): unknown;
declare function clearInterval(id: unknown): void;

/**
 * The current time in epoch ms, refreshed every `refreshMs`. Reading the clock
 * during render makes a component's output depend on when React happened to
 * call it; holding it in state makes it a value React knows changed.
 */
export function useNow(refreshMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), refreshMs);
    return () => clearInterval(timer);
  }, [refreshMs]);
  return now;
}
