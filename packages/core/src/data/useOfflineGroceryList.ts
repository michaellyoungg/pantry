import { api } from "@pantry/convex/api";
import { useConvexConnectionState, useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyPending,
  decodeGroceryCache,
  encodeGroceryCache,
  GROCERY_CACHE_VERSION,
  type GroceryCache,
  groceryLineKey,
  type OfflineStore,
  planReplay,
  type ReplayConflict,
} from "../groceryOffline";
import { type GroceryLine, type UseGroceryList, useGroceryList } from "./useGroceryList";

/** What the screen needs to say about the state of the connection (BL-0058). */
export type OfflineStatus = {
  /** True while there is a live socket to Convex. */
  online: boolean;
  /**
   * True once the durable cache has been read.
   *
   * Distinct from `loading`: the list may be perfectly renderable from the
   * cache while the server has still said nothing, which is the entire point.
   */
  ready: boolean;
  /** Check-offs waiting to be replayed. */
  queued: number;
  /** Device clock when the shown list was last confirmed by the server. */
  syncedAt: number | null;
  /**
   * Queued check-offs that could not be replayed and need the shopper's
   * answer. Never resolved silently — see {@link ReplayConflict}.
   */
  conflicts: ReplayConflict[];
  /** Drops one conflict without acting on it. */
  dismissConflict: (conflict: ReplayConflict) => void;
  /** Does what the shopper originally asked, now, with what the server has. */
  applyConflict: (conflict: ReplayConflict) => void;
};

export type UseOfflineGroceryList = UseGroceryList & { offline: OfflineStatus };

const EMPTY_CACHE: GroceryCache<GroceryLine> = {
  version: GROCERY_CACHE_VERSION,
  lines: [],
  pending: [],
  syncedAt: 0,
};

/**
 * {@link useGroceryList}, but it survives the freezer aisle (BL-0058).
 *
 * A wrapper rather than a flag inside `useGroceryList`, because offline is a
 * property of *this client*: the web app runs on a machine with a stable
 * connection and a browser that will happily hold the socket, and giving it a
 * durable cache and a replay queue would be carrying the risk for none of the
 * benefit. Everything shared — the derivations, the mutations, the animation
 * windows — still comes from the one hook underneath.
 *
 * Three responsibilities, and nothing else:
 *
 * 1. **A durable list.** The last server view is written to `store`, so a cold
 *    start with no signal opens on the list instead of a spinner.
 * 2. **A queue.** A check-off made with no socket is appended rather than sent,
 *    and drawn over the cached list so it is still there after the app is
 *    killed and relaunched.
 * 3. **A replay.** On reconnect the queue is collapsed to one intent per line,
 *    each intent re-resolved against the list as it is *now*, and the result
 *    issued as ordinary `toggleItem` calls. What cannot be replayed comes back
 *    as a conflict for the shopper to answer, never as silence.
 *
 * The reconciliation itself is `groceryOffline.ts` — pure, and where the
 * interesting cases are actually tested. This file is the wiring.
 *
 * @param store Durable key-value storage. Must be stable across renders; a
 *   module-level constant is the intended shape.
 */
export function useOfflineGroceryList(store: OfflineStore): UseOfflineGroceryList {
  // The one subscription. `useGroceryList` is handed the result below and skips
  // its own, so the list is still fetched exactly once.
  const server = useQuery(api.groceryList.getGroceryList);
  const online = useConvexConnectionState().isWebSocketConnected;

  const [cache, setCache] = useState<GroceryCache<GroceryLine>>(EMPTY_CACHE);
  const [ready, setReady] = useState(false);
  // Whether the read found a list, as opposed to finishing with nothing. The
  // two are the difference between "here is your list, from earlier" and "we
  // genuinely do not know yet" — which the screen renders very differently.
  const [restored, setRestored] = useState(false);
  const [conflicts, setConflicts] = useState<ReplayConflict[]>([]);

  // Held in a ref rather than a dependency: the store is a device-wide handle,
  // not a value, and listing it would re-read and re-write the cache for every
  // caller that forgets to memoize one.
  const storeRef = useRef(store);
  storeRef.current = store;

  useEffect(() => {
    let cancelled = false;
    void storeRef.current.read().then((raw) => {
      if (cancelled) return;
      const stored = decodeGroceryCache<GroceryLine>(raw);
      setCache(stored ?? EMPTY_CACHE);
      setRestored(stored !== null);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Every change to the cache is written straight through. A queued check-off
  // that only ever lived in React state would be lost by the OS reclaiming the
  // app in a shop with no signal — which is the exact moment it matters.
  useEffect(() => {
    if (!ready) return;
    void storeRef.current.write(encodeGroceryCache(cache));
  }, [cache, ready]);

  /**
   * The cached list tracks the server only while the queue is empty.
   *
   * That freeze is load-bearing twice over. It is what the replay compares
   * against to tell a line nobody has touched from one another shopper has
   * since decided about; and it is what the screen draws the queued taps over,
   * so the two can never disagree about what "before" was.
   */
  useEffect(() => {
    if (!ready || server === undefined) return;
    setCache((current) =>
      current.pending.length > 0
        ? current
        : { ...current, lines: server, syncedAt: online ? Date.now() : current.syncedAt },
    );
  }, [ready, server, online]);

  // The live view: whatever the server last managed to say, with the queue
  // drawn over it. Offline that is the frozen cache; online with an empty queue
  // it is the server's own list, untouched.
  const lines = useMemo(
    () => applyPending(server ?? cache.lines, cache.pending),
    [server, cache.lines, cache.pending],
  );

  // Still loading only while there is nothing to draw from either end. A cache
  // is an answer; finishing the read with no cache is not one, so a first run
  // in a shop with no signal keeps saying so rather than claiming an empty list.
  const list = useGroceryList({ lines, loading: server === undefined && !restored });
  const { toggle: toggleNow, addManual } = list;

  // Guards the replay against running twice over one queue — the effect below
  // re-runs the moment `server` changes, which on reconnect is immediately.
  const replaying = useRef(false);

  useEffect(() => {
    if (!ready || !online || server === undefined) return;
    if (cache.pending.length === 0) {
      replaying.current = false;
      return;
    }
    if (replaying.current) return;
    replaying.current = true;

    const plan = planReplay(cache.pending, server, cache.lines);
    // Cleared before the writes go out, not after: each write is optimistic and
    // lands in `server` on its own, and leaving the queue up would draw it a
    // second time over the answer.
    setCache((current) => ({ ...current, pending: [] }));
    if (plan.conflicts.length > 0) {
      setConflicts((current) => [...current, ...plan.conflicts]);
    }
    const byId = new Map(server.map((line) => [line._id, line]));
    for (const write of plan.writes) {
      const row = byId.get(write.id);
      if (row !== undefined) toggleNow(row, write.checked);
    }
  }, [ready, online, server, cache.pending, cache.lines, toggleNow]);

  const toggle = useCallback(
    (line: GroceryLine, checked: boolean) => {
      if (online) {
        toggleNow(line, checked);
        return;
      }
      // Queued by composite key, never by document id: a regeneration between
      // here and the replay would leave the id pointing at nothing.
      setCache((current) => ({
        ...current,
        pending: [
          ...current.pending,
          { item: line.item, unit: line.unit, aisle: line.aisle, checked, at: Date.now() },
        ],
      }));
    },
    [online, toggleNow],
  );

  const dismissConflict = useCallback((conflict: ReplayConflict) => {
    setConflicts((current) => current.filter((other) => other.key !== conflict.key));
  }, []);

  /**
   * "Do it anyway."
   *
   * Re-resolves the key one more time, because the shopper is answering a
   * prompt that may have been on screen for a while. If something now carries
   * it, the original intent is simply applied. If nothing does — the line was
   * hard-deleted and has not come back — the closest thing to the intent is to
   * put it back on the list, unchecked, for the shopper to tick off, which is
   * also the only path that writes the pantry inflow the deletion cost them.
   */
  const applyConflict = useCallback(
    (conflict: ReplayConflict) => {
      dismissConflict(conflict);
      const row = (server ?? []).find((line) => groceryLineKey(line) === conflict.key);
      if (row !== undefined) {
        toggleNow(row, conflict.checked);
        return;
      }
      if (conflict.checked) addManual(conflict.item);
    },
    [server, toggleNow, addManual, dismissConflict],
  );

  return {
    ...list,
    toggle,
    offline: {
      online,
      ready,
      queued: cache.pending.length,
      syncedAt: cache.syncedAt === 0 ? null : cache.syncedAt,
      conflicts,
      dismissConflict,
      applyConflict,
    },
  };
}
