// Shopping with no signal, and putting the shop back together afterwards
// (BL-0058). Pure: the cache is a string, the reconciliation is a function of
// three lists, and neither knows what a device or a Convex client is.
//
// The whole design turns on one fact about `toggleItem`
// (`packages/convex/convex/groceryList.ts`): it is keyed on a Convex **document
// id**, and checking a line off also writes pantry inflow (BL-0021) while
// un-checking removes it and clears the leftover answer (BL-0032). So the
// obvious offline design — a queue of mutations replayed in order — is wrong
// twice over. The ids go stale the moment the plan is regenerated, and
// replaying every tap drives the pantry through intermediate states that its
// own upsert/remove semantics were never asked to survive.
//
// What is replayed instead is the shopper's *final intent per line*: one
// desired `checked` value per `item|unit|aisle`, re-resolved to whatever
// document now carries that key. Idempotent, order-independent, and it lands
// the pantry side effects exactly once each.

// --- the key ---

/** The three fields the composite is built from. */
export type KeyedLine = { item: string; unit: string; aisle: string };

/**
 * The composite a queued check-off survives on.
 *
 * It is the same triple `mergeGroceryList` merges on, and that is not a
 * coincidence — it is the only identity a grocery line keeps across a
 * regeneration. The document id does not: regeneration deletes and re-inserts,
 * so a tap queued in the freezer aisle and replayed twenty minutes later is
 * holding an id that may no longer resolve.
 *
 * Pipe-separated rather than space-separated so a unit containing a space
 * cannot collide two different lines into one key.
 */
export function groceryLineKey(line: KeyedLine): string {
  return `${line.item}|${line.unit}|${line.aisle}`;
}

// --- the queue ---

/**
 * One check-off made while the list could not be written to.
 *
 * It carries the line's identity rather than its document id, for the reason
 * above, and its own device timestamp — which orders *this device's* taps
 * against each other and is never compared with anything the server said. A
 * phone that has been in a pocket since breakfast is not a clock.
 */
export type PendingCheckoff = KeyedLine & {
  /** What the shopper wants this line to be. */
  checked: boolean;
  /** Device clock at the tap. Orders the queue; never compared to server time. */
  at: number;
};

/** One line's net intent, after everything the shopper did to it. */
export type CollapsedCheckoff = PendingCheckoff & { key: string };

/**
 * The queue, reduced to one intent per line: the last tap wins.
 *
 * This is the collapse the whole feature is named for. A shopper who ticks
 * "butter", walks past the till, changes their mind and un-ticks it has
 * expressed *one* thing — that they are not buying butter — and replaying both
 * taps would write the pantry inflow and then remove it again. Which is not
 * merely wasteful: `upsertFromCheckoff` and `removeAutoRow` are the don't-rebuy
 * signal, and driving them through an inflow the shopper never had is how an
 * offline queue corrupts pantry data rather than merely losing a tap.
 *
 * Order in the returned array is first-tap order, so a replay walks the list in
 * roughly the order the shopper walked the store — worth nothing to the server,
 * worth something to anyone reading a log of what happened.
 */
export function collapsePending(pending: readonly PendingCheckoff[]): CollapsedCheckoff[] {
  const byKey = new Map<string, CollapsedCheckoff>();
  for (const tap of pending) {
    const key = groceryLineKey(tap);
    const previous = byKey.get(key);
    // Ties keep the later arrival: two taps sharing a millisecond are still
    // ordered by the queue they were appended to.
    if (previous !== undefined && previous.at > tap.at) continue;
    byKey.set(key, { ...tap, key });
  }
  return [...byKey.values()];
}

// --- the cache ---

/**
 * What a cached line has to carry for reconciliation to work. Clients cache the
 * whole row — the screen has to render from it — but only these four fields are
 * load-bearing here.
 */
export type ReplayableLine = KeyedLine & {
  _id: string;
  checked: boolean;
  /** Server clock at the last toggle; absent on a line nobody has ticked. */
  checkedAt?: number;
};

/**
 * Bumped whenever the shape below changes in a way an old cache cannot satisfy.
 * A cache that does not match is discarded rather than migrated: it is at worst
 * one shop's worth of a list the server still has.
 */
export const GROCERY_CACHE_VERSION = 1;

export type GroceryCache<T extends ReplayableLine = ReplayableLine> = {
  version: number;
  /** The last server view of the list this device saw. */
  lines: T[];
  /** Taps made since, oldest first. */
  pending: PendingCheckoff[];
  /** Device clock when `lines` was captured, for "your list from …". */
  syncedAt: number;
};

/**
 * How a client hands the cache to its platform's durable storage. Two methods,
 * both async, both over one opaque string — anything narrower would put a
 * storage API's shape into the headless layer, and every platform has a
 * different one.
 */
export type OfflineStore = {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
  clear(): Promise<void>;
};

export function encodeGroceryCache<T extends ReplayableLine>(cache: GroceryCache<T>): string {
  return JSON.stringify(cache);
}

/**
 * Reads a cache back, or `null` if there isn't a usable one.
 *
 * Every failure mode lands on the same answer, including a truncated write, a
 * cache written by an older build, and anything that is simply not this. The
 * caller then behaves exactly as it would on a fresh install, which is the only
 * behaviour that is safe: a half-understood cache would be replayed against the
 * shopper's real list.
 *
 * Note what is *not* validated — the fields of each line. The lines came from
 * the server, and re-checking them here would be a second, drifting copy of the
 * schema. What is checked is the frame the replay indexes on.
 */
export function decodeGroceryCache<T extends ReplayableLine>(
  raw: string | null,
): GroceryCache<T> | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const cache = parsed as Partial<GroceryCache<T>>;
  if (cache.version !== GROCERY_CACHE_VERSION) return null;
  if (!Array.isArray(cache.lines) || !Array.isArray(cache.pending)) return null;
  if (typeof cache.syncedAt !== "number") return null;
  return {
    version: cache.version,
    lines: cache.lines,
    pending: cache.pending,
    syncedAt: cache.syncedAt,
  };
}

/**
 * The cached list as the shopper last left it — queued taps written over the
 * lines they apply to.
 *
 * This is what makes the queue visible. Without it a check-off made in the
 * freezer aisle would un-tick itself the moment the app was killed and
 * relaunched, because the cached list is the last thing the *server* said, and
 * the server has not heard about the tap yet.
 *
 * A queued tap whose line is not in the cache is dropped here rather than
 * conjuring a row — there is nothing to draw. It survives in the queue, and
 * `planReplay` is where its fate is decided.
 */
export function applyPending<T extends ReplayableLine>(
  lines: readonly T[],
  pending: readonly PendingCheckoff[],
): T[] {
  if (pending.length === 0) return [...lines];
  const intents = new Map(collapsePending(pending).map((intent) => [intent.key, intent.checked]));
  return lines.map((line) => {
    const checked = intents.get(groceryLineKey(line));
    return checked === undefined || checked === line.checked ? line : { ...line, checked };
  });
}

// --- the replay ---

/** One `toggleItem` to issue, against a document id resolved just now. */
export type ReplayWrite<T extends ReplayableLine> = { id: T["_id"]; checked: boolean };

/**
 * A queued tap that will not be replayed, and which the shopper has to be told
 * about.
 *
 * - `missing` — nothing on the server carries this key any more. The line was
 *   hard-deleted by a regeneration that happened before it ever heard about the
 *   check-off. Dropping it silently loses a real purchase *and* the pantry
 *   inflow that purchase should have written, so it is surfaced.
 * - `superseded` — the line is still there, but somebody wrote to it after this
 *   device last saw it, and said something else. Replaying would overwrite a
 *   decision that was made with more information than this one had.
 */
export type ReplayConflict = KeyedLine & {
  key: string;
  /** What the shopper asked for, so the prompt can offer to do it after all. */
  checked: boolean;
  reason: "missing" | "superseded";
};

export type ReplayPlan<T extends ReplayableLine> = {
  /** One toggle per line, in first-tap order. */
  writes: ReplayWrite<T>[];
  /** Keys whose intent the server already satisfies — nothing to send. */
  settled: string[];
  /** What could not be replayed. Never empty silently: the caller must show it. */
  conflicts: ReplayConflict[];
};

/**
 * What to send on reconnect.
 *
 * Three inputs, and the third is the one that is easy to leave out: `seen` is
 * the list *as this device last saw it*, and without it there is no way to tell
 * a line nobody has touched from one another shopper has since decided about.
 * Both look like "the server says false and I want true".
 *
 * The recency test compares two server timestamps — the one on the row now
 * against the one cached beside it — and never the device's own clock, which is
 * the only comparison available to a phone that has been offline for an hour
 * and may be minutes out. If the row has been stamped since this device's last
 * view, the other writer had strictly more information, and wins.
 *
 * Order of the three questions matters. "Does the server already agree?" is
 * asked first, so the common case — the shopper ticked something, nobody else
 * touched it, and the tick has somehow already landed — is silence rather than
 * a conflict prompt. Only a difference that survives that is worth anyone's
 * attention.
 */
export function planReplay<T extends ReplayableLine>(
  pending: readonly PendingCheckoff[],
  server: readonly T[],
  seen: readonly ReplayableLine[],
): ReplayPlan<T> {
  const current = new Map(server.map((line) => [groceryLineKey(line), line]));
  const lastSeen = new Map(seen.map((line) => [groceryLineKey(line), line]));
  const plan: ReplayPlan<T> = { writes: [], settled: [], conflicts: [] };

  for (const intent of collapsePending(pending)) {
    const { key, item, unit, aisle, checked } = intent;
    const row = current.get(key);
    if (row === undefined) {
      plan.conflicts.push({ key, item, unit, aisle, checked, reason: "missing" });
      continue;
    }
    if (row.checked === checked) {
      plan.settled.push(key);
      continue;
    }
    if ((row.checkedAt ?? 0) > (lastSeen.get(key)?.checkedAt ?? 0)) {
      plan.conflicts.push({ key, item, unit, aisle, checked, reason: "superseded" });
      continue;
    }
    plan.writes.push({ id: row._id, checked });
  }
  return plan;
}
