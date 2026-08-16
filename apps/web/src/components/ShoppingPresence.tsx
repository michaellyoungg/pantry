import { api } from "@pantry/convex/api";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";

/**
 * How often this client says "still here". Comfortably inside the server's
 * PRESENCE_TTL_MS, so one beat lost to a shop's bad signal does not blink this
 * device out of existence on the other phone.
 */
export const HEARTBEAT_MS = 15_000;

/**
 * Who else is on this list right now (BL-0019).
 *
 * The list has been genuinely live since it was built on Convex — two phones in
 * a shop already see each other's ticks — but nothing ever said so, and a line
 * that strikes itself through under your thumb reads as a bug unless the app
 * has already told you someone else is holding the other half of the list.
 *
 * Deliberately the crudest thing that answers that: a count, no names, no
 * per-line "who". The question in an aisle is "is anyone else picking things
 * up?", and a number answers it. Silent when the answer is no.
 */
export function ShoppingPresence() {
  // One id per mounted list, generated here rather than persisted: the unit of
  // presence is a device with the list open, and a session that goes away
  // should not linger under a remembered id.
  const [sessionId] = useState(() => `s-${Math.random().toString(36).slice(2)}`);
  const heartbeat = useMutation(api.presence.heartbeat);
  const others = useQuery(api.presence.shoppers, { sessionId }) ?? 0;

  useEffect(() => {
    let stopped = false;
    // A failed beat is not worth surfacing: the cost of missing one is that
    // another device stops seeing this one for a few seconds.
    const beat = () => {
      if (!stopped) void heartbeat({ sessionId }).catch(() => {});
    };
    beat();
    const timer = setInterval(beat, HEARTBEAT_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [heartbeat, sessionId]);

  if (others === 0) return null;

  return (
    <p
      // Announced, because the point is that something is happening that the
      // user did not do.
      role="status"
      className="flex items-center gap-2 rounded-lg bg-primary/10 px-3 py-2 text-xs text-primary"
    >
      <span aria-hidden>●</span>
      {others === 1
        ? "Someone else is on this list right now"
        : `${others} others are on this list right now`}
    </p>
  );
}
