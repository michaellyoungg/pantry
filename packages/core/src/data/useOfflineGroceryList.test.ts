// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted and mutable so each test drives the socket and the list independently
// — the two halves this hook exists to hold together.
const { state, toggleMock, actionMock } = vi.hoisted(() => ({
  state: {
    lines: undefined as Array<Record<string, unknown>> | undefined,
    online: true,
    /** Every `getGroceryList` call's args this render, to prove one is skipped. */
    groceryArgs: [] as unknown[],
  },
  toggleMock: vi.fn(() => Promise.resolve()),
  actionMock: vi.fn(() => Promise.resolve(null)),
}));

vi.mock("convex/react", async () => {
  // Function references are lazily-built proxies, so identity comparison is not
  // reliable — the function's name is.
  const { getFunctionName } = await import("convex/server");
  return {
    useConvexConnectionState: () => ({ isWebSocketConnected: state.online }),
    useQuery: (query: Parameters<typeof getFunctionName>[0], args?: unknown) => {
      const name = getFunctionName(query);
      if (name.includes("getGroceryList")) {
        state.groceryArgs.push(args);
        return args === "skip" ? undefined : state.lines;
      }
      return args === "skip" ? undefined : [];
    },
    useAction: () => actionMock,
    useMutation: (ref: Parameters<typeof getFunctionName>[0]) => {
      const spy = getFunctionName(ref).endsWith("toggleItem") ? toggleMock : vi.fn();
      const fn = ((...args: unknown[]) =>
        (spy as (...a: unknown[]) => Promise<unknown>)(...args)) as unknown as {
        (...a: unknown[]): Promise<unknown>;
        withOptimisticUpdate: (u: unknown) => typeof fn;
      };
      fn.withOptimisticUpdate = () => fn;
      return fn;
    },
  };
});

import { encodeGroceryCache, GROCERY_CACHE_VERSION, type OfflineStore } from "../groceryOffline";
import type { GroceryLine } from "./useGroceryList";
import { useOfflineGroceryList } from "./useOfflineGroceryList";

function line(over: Record<string, unknown> = {}) {
  return {
    _id: "g1",
    _creationTime: 0,
    userId: "dev-user",
    item: "butter",
    canonicalItem: "butter",
    unit: "g",
    quantity: 250,
    aisle: "dairy",
    checked: false,
    ...over,
  };
}

/** An in-memory device store, so a test can inspect what was persisted. */
function fakeStore(initial: string | null = null) {
  let value = initial;
  return {
    read: vi.fn(async () => value),
    write: vi.fn(async (next: string) => {
      value = next;
    }),
    clear: vi.fn(async () => {
      value = null;
    }),
    get value() {
      return value;
    },
  } satisfies OfflineStore & { readonly value: string | null };
}

function cachedList(lines: Array<Record<string, unknown>>, pending: unknown[] = []) {
  return encodeGroceryCache({
    version: GROCERY_CACHE_VERSION,
    lines: lines as unknown as GroceryLine[],
    pending: pending as never,
    syncedAt: 1_000,
  });
}

/** Renders and waits for the cache read to settle, which every test needs. */
async function mount(store: OfflineStore) {
  const rendered = renderHook(() => useOfflineGroceryList(store));
  await waitFor(() => expect(rendered.result.current.offline.ready).toBe(true));
  return rendered;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.lines = [line()];
  state.online = true;
  state.groceryArgs = [];
});
afterEach(() => {
  // Unmounted explicitly, not left to the environment. Every test here has an
  // async device read in flight, and a hook still mounted when the file's jsdom
  // is torn down schedules React work against a `window` that no longer exists
  // — which surfaces as an unhandled error attributed to whichever test was
  // last, rather than to the mount that was never closed.
  cleanup();
  vi.restoreAllMocks();
});

describe("useOfflineGroceryList — the durable list", () => {
  it("opens on the cached list when the server has said nothing yet", async () => {
    // A cold start in a shop with no signal. Without this the screen is a
    // spinner for as long as the trip lasts.
    state.lines = undefined;
    state.online = false;
    const { result } = await mount(fakeStore(cachedList([line({ item: "eggs" })])));

    expect(result.current.loading).toBe(false);
    expect(result.current.lines.map((l) => l.item)).toEqual(["eggs"]);
    expect(result.current.offline.online).toBe(false);
  });

  it("prefers the server's list to the cache once the server answers", async () => {
    const { result } = await mount(fakeStore(cachedList([line({ item: "eggs" })])));
    expect(result.current.lines.map((l) => l.item)).toEqual(["butter"]);
  });

  it("caches the server's list, so the next cold start has one", async () => {
    const store = fakeStore();
    await mount(store);
    await waitFor(() => expect(store.write).toHaveBeenCalled());
    expect(store.value).toContain("butter");
    expect(JSON.parse(store.value ?? "").syncedAt).toBeGreaterThan(0);
  });

  it("behaves like a fresh install on a cache it cannot read", async () => {
    state.lines = undefined;
    state.online = false;
    const { result } = await mount(fakeStore("{ truncated"));
    expect(result.current.lines).toEqual([]);
    expect(result.current.offline.syncedAt).toBeNull();
  });

  it("keeps saying it does not know when the read finds nothing", async () => {
    // Finishing the read with no cache is not an answer. Reporting the list as
    // empty would tell a shopper with no signal that they have nothing to buy.
    state.lines = undefined;
    state.online = false;
    const { result } = await mount(fakeStore());
    expect(result.current.loading).toBe(true);
  });

  it("stops loading the moment a cached list is restored, server or no server", async () => {
    state.lines = undefined;
    state.online = false;
    const { result } = await mount(fakeStore(cachedList([line()])));
    expect(result.current.loading).toBe(false);
  });

  it("holds the one subscription itself, so the list is not fetched twice", async () => {
    const { rerender } = await mount(fakeStore());
    state.groceryArgs = [];
    rerender();
    // The outer hook subscribes; the inner one is handed the result and skips.
    expect(state.groceryArgs).toEqual([undefined, "skip"]);
  });

  it("still reports loading before either the cache or the server has answered", () => {
    state.lines = undefined;
    const { result } = renderHook(() => useOfflineGroceryList(fakeStore()));
    expect(result.current.loading).toBe(true);
  });
});

describe("useOfflineGroceryList — the queue", () => {
  it("queues a check-off rather than sending it when the socket is down", async () => {
    state.online = false;
    const { result } = await mount(fakeStore());

    act(() => result.current.toggle(result.current.lines[0], true));

    expect(toggleMock).not.toHaveBeenCalled();
    expect(result.current.offline.queued).toBe(1);
  });

  it("shows a queued check-off on the list it was made against", async () => {
    state.online = false;
    const { result } = await mount(fakeStore());

    act(() => result.current.toggle(result.current.lines[0], true));

    // The server still says false; the shopper must still see their own tap —
    // and it takes the same route into the cart as an online one, animation
    // window included, rather than teleporting.
    expect(result.current.lines[0].checked).toBe(true);
    expect([...result.current.leaving]).toEqual(["g1"]);
  });

  it("persists the queue, so killing the app in the freezer aisle costs nothing", async () => {
    state.online = false;
    const store = fakeStore();
    const { result } = await mount(store);

    act(() => result.current.toggle(result.current.lines[0], true));
    await waitFor(() => expect(store.value).toContain('"pending":[{'));

    // Relaunch: same device, same store, still no signal.
    state.lines = undefined;
    const relaunched = await mount(store);
    expect(relaunched.result.current.lines[0].checked).toBe(true);
    expect(relaunched.result.current.offline.queued).toBe(1);
  });

  it("sends a check-off straight through while the socket is up", async () => {
    const { result } = await mount(fakeStore());

    act(() => result.current.toggle(result.current.lines[0], true));

    expect(toggleMock).toHaveBeenCalledWith({ id: "g1", checked: true });
    expect(result.current.offline.queued).toBe(0);
  });

  it("freezes the cached list while a queue stands, so the replay keeps its baseline", async () => {
    state.online = false;
    const store = fakeStore();
    const { result, rerender } = await mount(store);
    act(() => result.current.toggle(result.current.lines[0], true));

    // Another shopper's edit arrives (the socket comes back, but the queue has
    // not been replayed yet). The cache must still describe the "before".
    state.lines = [line({ checked: true, checkedAt: 5_000 })];
    rerender();

    await waitFor(() => expect(JSON.parse(store.value ?? "").lines[0].checked).toBe(false));
  });
});

describe("useOfflineGroceryList — the replay", () => {
  it("replays the net intent as one toggle on reconnect", async () => {
    state.online = false;
    const { result, rerender } = await mount(fakeStore());
    act(() => result.current.toggle(result.current.lines[0], true));

    state.online = true;
    rerender();

    await waitFor(() => expect(toggleMock).toHaveBeenCalledWith({ id: "g1", checked: true }));
    expect(toggleMock).toHaveBeenCalledTimes(1);
    expect(result.current.offline.queued).toBe(0);
  });

  it("collapses a check-off and an un-check into no write at all", async () => {
    // The pantry case. Replaying both taps would write the don't-rebuy inflow
    // for butter and then remove it — through a purchase that never happened.
    state.online = false;
    const { result, rerender } = await mount(fakeStore());
    act(() => result.current.toggle(result.current.lines[0], true));
    act(() => result.current.toggle(result.current.lines[0], false));

    state.online = true;
    rerender();

    await waitFor(() => expect(result.current.offline.queued).toBe(0));
    expect(toggleMock).not.toHaveBeenCalled();
    expect(result.current.offline.conflicts).toEqual([]);
  });

  it("re-resolves the key, so a regeneration mid-trip does not lose the tap", async () => {
    state.online = false;
    const { result, rerender } = await mount(fakeStore());
    act(() => result.current.toggle(result.current.lines[0], true));

    // The plan was regenerated on another device: same line, new document id.
    state.lines = [line({ _id: "g2" })];
    state.online = true;
    rerender();

    await waitFor(() => expect(toggleMock).toHaveBeenCalledWith({ id: "g2", checked: true }));
  });

  it("loses to a newer server state and says so", async () => {
    state.online = false;
    const { result, rerender } = await mount(fakeStore());
    act(() => result.current.toggle(result.current.lines[0], true));

    // The other shopper ticked it and put it back, after this device's view.
    state.lines = [line({ checked: false, checkedAt: 9_000 })];
    state.online = true;
    rerender();

    await waitFor(() => expect(result.current.offline.conflicts).toHaveLength(1));
    expect(toggleMock).not.toHaveBeenCalled();
    expect(result.current.offline.conflicts[0]).toMatchObject({
      item: "butter",
      checked: true,
      reason: "superseded",
    });
    // And the list is the server's, not the shopper's stale intent.
    expect(result.current.lines[0].checked).toBe(false);
  });

  it("surfaces a check-off whose line the server no longer has", async () => {
    state.online = false;
    const { result, rerender } = await mount(fakeStore());
    act(() => result.current.toggle(result.current.lines[0], true));

    state.lines = [line({ _id: "g9", item: "eggs" })];
    state.online = true;
    rerender();

    await waitFor(() => expect(result.current.offline.conflicts).toHaveLength(1));
    expect(result.current.offline.conflicts[0].reason).toBe("missing");
  });

  it("replays once, not once per server update", async () => {
    state.online = false;
    const { result, rerender } = await mount(fakeStore());
    act(() => result.current.toggle(result.current.lines[0], true));

    state.online = true;
    rerender();
    await waitFor(() => expect(toggleMock).toHaveBeenCalledTimes(1));

    // The optimistic write lands, then the server confirms it. Neither is a
    // reason to send the toggle again.
    state.lines = [line({ checked: true, checkedAt: 9_000 })];
    rerender();
    await waitFor(() => expect(result.current.offline.queued).toBe(0));
    expect(toggleMock).toHaveBeenCalledTimes(1);
  });
});

describe("useOfflineGroceryList — answering a conflict", () => {
  async function withConflict(serverLines: Array<Record<string, unknown>>) {
    state.online = false;
    const rendered = await mount(fakeStore());
    act(() => rendered.result.current.toggle(rendered.result.current.lines[0], true));
    state.lines = serverLines;
    state.online = true;
    rendered.rerender();
    await waitFor(() => expect(rendered.result.current.offline.conflicts).toHaveLength(1));
    return rendered;
  }

  it("drops a dismissed conflict without writing anything", async () => {
    const { result } = await withConflict([line({ checked: false, checkedAt: 9_000 })]);

    act(() => result.current.offline.dismissConflict(result.current.offline.conflicts[0]));

    expect(result.current.offline.conflicts).toEqual([]);
    expect(toggleMock).not.toHaveBeenCalled();
  });

  it("applies the original intent to whatever now carries the key", async () => {
    const { result } = await withConflict([line({ _id: "g3", checked: false, checkedAt: 9_000 })]);

    act(() => result.current.offline.applyConflict(result.current.offline.conflicts[0]));

    expect(toggleMock).toHaveBeenCalledWith({ id: "g3", checked: true });
    expect(result.current.offline.conflicts).toEqual([]);
  });

  it("puts a hard-deleted line back on the list, since there is nothing to toggle", async () => {
    const { result } = await withConflict([line({ _id: "g9", item: "eggs" })]);

    act(() => result.current.offline.applyConflict(result.current.offline.conflicts[0]));

    expect(toggleMock).not.toHaveBeenCalled();
    expect(actionMock).toHaveBeenCalledWith(expect.objectContaining({ item: "butter" }));
  });
});
