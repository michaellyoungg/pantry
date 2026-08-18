import { describe, expect, it } from "vitest";
import {
  applyPending,
  collapsePending,
  decodeGroceryCache,
  encodeGroceryCache,
  GROCERY_CACHE_VERSION,
  type GroceryCache,
  groceryLineKey,
  type PendingCheckoff,
  planReplay,
  type ReplayableLine,
} from "./groceryOffline";

function line(over: Partial<ReplayableLine> = {}): ReplayableLine {
  return { _id: "g1", item: "butter", unit: "g", aisle: "dairy", checked: false, ...over };
}

function tap(over: Partial<PendingCheckoff> = {}): PendingCheckoff {
  return { item: "butter", unit: "g", aisle: "dairy", checked: true, at: 1_000, ...over };
}

describe("groceryLineKey", () => {
  it("keys on the composite a line keeps across a regeneration, not its id", () => {
    // Same line, re-inserted by a regeneration under a new document id.
    expect(groceryLineKey(line({ _id: "g1" }))).toBe(groceryLineKey(line({ _id: "g2" })));
  });

  it("separates the parts, so a unit containing a space cannot collide two lines", () => {
    const a = groceryLineKey({ item: "olive oil", unit: "fl oz", aisle: "pantry" });
    const b = groceryLineKey({ item: "olive", unit: "oil fl", aisle: "oz pantry" });
    expect(a).not.toBe(b);
  });
});

describe("collapsePending", () => {
  it("reduces a check-off and an un-check of the same line to one net intent", () => {
    // The case the whole feature is named for. Replaying both taps would write
    // the pantry inflow and then remove it again — driving the don't-rebuy
    // signal through a purchase the shopper decided against.
    const collapsed = collapsePending([
      tap({ checked: true, at: 1 }),
      tap({ checked: false, at: 2 }),
    ]);
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0].checked).toBe(false);
  });

  it("keeps the last tap however many times the shopper changed their mind", () => {
    const collapsed = collapsePending([
      tap({ checked: true, at: 1 }),
      tap({ checked: false, at: 2 }),
      tap({ checked: true, at: 3 }),
      tap({ checked: false, at: 4 }),
      tap({ checked: true, at: 5 }),
    ]);
    expect(collapsed.map((c) => c.checked)).toEqual([true]);
  });

  it("is order-independent — an out-of-order queue collapses to the same intent", () => {
    const taps = [tap({ checked: true, at: 1 }), tap({ checked: false, at: 2 })];
    expect(collapsePending(taps)[0].checked).toBe(collapsePending([...taps].reverse())[0].checked);
  });

  it("keeps one intent per line, in first-tap order", () => {
    const collapsed = collapsePending([
      tap({ item: "butter", at: 1 }),
      tap({ item: "eggs", at: 2 }),
      tap({ item: "butter", checked: false, at: 3 }),
    ]);
    expect(collapsed.map((c) => c.item)).toEqual(["butter", "eggs"]);
  });

  it("breaks a tie on the same millisecond by queue position", () => {
    const collapsed = collapsePending([
      tap({ checked: true, at: 7 }),
      tap({ checked: false, at: 7 }),
    ]);
    expect(collapsed[0].checked).toBe(false);
  });

  it("has nothing to say about an empty queue", () => {
    expect(collapsePending([])).toEqual([]);
  });
});

describe("the cache", () => {
  const cache: GroceryCache = {
    version: GROCERY_CACHE_VERSION,
    lines: [line()],
    pending: [tap()],
    syncedAt: 5_000,
  };

  it("round-trips", () => {
    expect(decodeGroceryCache(encodeGroceryCache(cache))).toEqual(cache);
  });

  it("reads nothing on a fresh install", () => {
    expect(decodeGroceryCache(null)).toBeNull();
  });

  it("discards a cache written by an older build rather than migrating it", () => {
    const stale = encodeGroceryCache({ ...cache, version: GROCERY_CACHE_VERSION - 1 });
    expect(decodeGroceryCache(stale)).toBeNull();
  });

  it.each([
    ["truncated by a write that never finished", '{"version":1,"lines":['],
    ["something that is simply not this", '"a string"'],
    ["null", "null"],
    ["missing its lines", '{"version":1,"pending":[],"syncedAt":0}'],
    ["missing its queue", '{"version":1,"lines":[],"syncedAt":0}'],
    ["missing when it was captured", '{"version":1,"lines":[],"pending":[]}'],
  ])("behaves like a fresh install on a cache %s", (_why, raw) => {
    // Every failure lands on the same answer, because the alternative — acting
    // on half a cache — replays a guess against the shopper's real list.
    expect(decodeGroceryCache(raw)).toBeNull();
  });
});

describe("applyPending", () => {
  it("shows a queued tap on the cached list, so it survives the app being killed", () => {
    const shown = applyPending([line({ checked: false })], [tap({ checked: true })]);
    expect(shown[0].checked).toBe(true);
  });

  it("shows the net intent, not each tap", () => {
    const shown = applyPending(
      [line({ checked: false })],
      [tap({ checked: true, at: 1 }), tap({ checked: false, at: 2 })],
    );
    expect(shown[0].checked).toBe(false);
  });

  it("leaves lines the queue says nothing about exactly as they were", () => {
    const lines = [line({ _id: "a", item: "butter" }), line({ _id: "b", item: "eggs" })];
    const shown = applyPending(lines, [tap({ item: "butter" })]);
    expect(shown[1]).toBe(lines[1]);
  });

  it("returns the list untouched when there is nothing queued", () => {
    const lines = [line()];
    expect(applyPending(lines, [])).toEqual(lines);
  });

  it("draws nothing for a queued tap whose line is not in the cache", () => {
    // Its fate is planReplay's to decide; there is no row here to draw.
    expect(applyPending([line({ item: "eggs" })], [tap({ item: "butter" })])).toHaveLength(1);
  });
});

describe("planReplay", () => {
  it("re-resolves the key to whatever document now carries it", () => {
    // The stale-id failure this design exists to avoid: the queued tap was made
    // against `g1`, which a regeneration deleted and re-inserted as `g2`.
    const plan = planReplay([tap({ checked: true })], [line({ _id: "g2" })], [line({ _id: "g1" })]);
    expect(plan.writes).toEqual([{ id: "g2", checked: true }]);
  });

  it("issues one toggle per line, never one per tap", () => {
    const plan = planReplay(
      [
        tap({ checked: true, at: 1 }),
        tap({ checked: false, at: 2 }),
        tap({ checked: true, at: 3 }),
      ],
      [line({ checked: false })],
      [line({ checked: false })],
    );
    expect(plan.writes).toEqual([{ id: "g1", checked: true }]);
  });

  it("sends nothing at all when the taps cancelled each other out", () => {
    // A check-off and an un-check of a line that was unchecked to begin with is
    // one net operation, and that operation is "nothing". Sending the toggle
    // anyway would clear a leftover answer and remove a pantry row on a line
    // the shopper never actually changed.
    const plan = planReplay(
      [tap({ checked: true, at: 1 }), tap({ checked: false, at: 2 })],
      [line({ checked: false })],
      [line({ checked: false })],
    );
    expect(plan.writes).toEqual([]);
    expect(plan.settled).toEqual([groceryLineKey(line())]);
    expect(plan.conflicts).toEqual([]);
  });

  it("is idempotent — replaying a plan whose writes already landed sends nothing", () => {
    const queue = [tap({ checked: true })];
    const seen = [line({ checked: false })];
    const first = planReplay(queue, [line({ checked: false })], seen);
    expect(first.writes).toHaveLength(1);
    // The server now reflects the write, and this device saw it happen.
    const second = planReplay(queue, [line({ checked: true, checkedAt: 10 })], seen);
    expect(second.writes).toEqual([]);
    expect(second.conflicts).toEqual([]);
  });

  it("loses to a newer server state rather than overwriting it", () => {
    // Cached view: unchecked, never ticked. This device queued a check-off.
    // Meanwhile the other shopper ticked it and then un-ticked it — they put it
    // back on the shelf — and that decision is stamped after this device's last
    // view. It was made with more information, so it stands.
    const plan = planReplay(
      [tap({ checked: true })],
      [line({ checked: false, checkedAt: 900 })],
      [line({ checked: false })],
    );
    expect(plan.writes).toEqual([]);
    expect(plan.conflicts).toEqual([
      {
        key: groceryLineKey(line()),
        item: "butter",
        unit: "g",
        aisle: "dairy",
        checked: true,
        reason: "superseded",
      },
    ]);
  });

  it("replays over a line stamped before this device's last view", () => {
    // Same shape, opposite verdict: the other shopper's write is one this
    // device had already seen, so the queued tap is the newer word.
    const plan = planReplay(
      [tap({ checked: true })],
      [line({ checked: false, checkedAt: 900 })],
      [line({ checked: false, checkedAt: 900 })],
    );
    expect(plan.writes).toEqual([{ id: "g1", checked: true }]);
  });

  it("does not call it a conflict when the newer server state is what was wanted anyway", () => {
    // The other shopper ticked the same line off. Nothing to argue about, and
    // nothing to prompt the shopper with.
    const plan = planReplay(
      [tap({ checked: true })],
      [line({ checked: true, checkedAt: 900 })],
      [line({ checked: false })],
    );
    expect(plan.writes).toEqual([]);
    expect(plan.conflicts).toEqual([]);
    expect(plan.settled).toEqual([groceryLineKey(line())]);
  });

  it("surfaces a check-off whose line the server no longer has", () => {
    // The unresolvable case. A regeneration hard-deleted this unchecked line
    // before it ever heard the check-off, so there is nothing to toggle —
    // and dropping it silently loses a real purchase and its pantry inflow.
    const plan = planReplay([tap({ item: "butter", checked: true })], [line({ item: "eggs" })], []);
    expect(plan.writes).toEqual([]);
    expect(plan.conflicts).toEqual([
      {
        key: groceryLineKey(line()),
        item: "butter",
        unit: "g",
        aisle: "dairy",
        checked: true,
        reason: "missing",
      },
    ]);
  });

  it("plans each line on its own — one conflict does not block the rest", () => {
    const plan = planReplay(
      [
        tap({ item: "butter", checked: true }),
        tap({ item: "eggs", checked: true }),
        tap({ item: "flour", checked: true }),
      ],
      [
        line({ _id: "e", item: "eggs", checked: false }),
        line({ _id: "f", item: "flour", checked: true, checkedAt: 900 }),
      ],
      [line({ _id: "e", item: "eggs" })],
    );
    expect(plan.writes).toEqual([{ id: "e", checked: true }]);
    expect(plan.settled).toEqual([groceryLineKey({ item: "flour", unit: "g", aisle: "dairy" })]);
    expect(plan.conflicts.map((c) => c.item)).toEqual(["butter"]);
  });

  it("has nothing to do with an empty queue", () => {
    expect(planReplay([], [line()], [line()])).toEqual({
      writes: [],
      settled: [],
      conflicts: [],
    });
  });
});
