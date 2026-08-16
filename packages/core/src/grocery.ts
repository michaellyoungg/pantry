// Grocery-list presentation logic that isn't presentation: the aisle grouping a
// shopper walks the store by, independent of how a client draws it.

/** The only field the grouping cares about — anything with an aisle can group. */
export type AisleLine = { aisle: string };

export type AisleGroup<T extends AisleLine> = { aisle: string; lines: T[] };

/**
 * Lines arrive pre-sorted by aisle from recipe-service, so grouping is a scan of
 * consecutive runs rather than a re-sort. That deliberately preserves the
 * server's aisle order (store walk order), and a line that reappears out of run
 * opens a second group rather than being folded back into the first.
 */
export function groupByAisle<T extends AisleLine>(lines: readonly T[]): AisleGroup<T>[] {
  const groups: AisleGroup<T>[] = [];
  for (const line of lines) {
    const last = groups[groups.length - 1];
    if (last && last.aisle === line.aisle) last.lines.push(line);
    else groups.push({ aisle: line.aisle, lines: [line] });
  }
  return groups;
}

/** Aisle names arrive lowercase; capitalise the first letter for a heading. */
export function titleCase(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** A line the plan has dropped after the shopper already checked it off. */
export type RemovableLine = { removed?: boolean };

/**
 * Splits a generated list into what is still being shopped for and what the
 * plan has since dropped (BL-0018). The two halves are rendered apart rather
 * than interleaved: a flagged line is history — already in the cart, no longer
 * called for — and mixing it into the aisle walk would read as something still
 * to buy. Order within each half is the server's aisle order, untouched.
 */
export function partitionRemoved<T extends RemovableLine>(
  lines: readonly T[],
): { active: T[]; removed: T[] } {
  const active: T[] = [];
  const removed: T[] = [];
  for (const line of lines) (line.removed ? removed : active).push(line);
  return { active, removed };
}

/** A line that can be in the cart or still on the walk. */
export type CartLine = { checked: boolean };

/**
 * Splits the active list into what is still to buy and what is already in the
 * cart (BL-0019).
 *
 * Checked lines used to strike through in place, which meant the top of a
 * half-shopped list was mostly things the shopper had already dealt with — the
 * one thing a list read one-handed in an aisle must never be. Moving them into
 * their own section keeps the top of the list "what's left", and keeps the
 * cart auditable at the till without re-reading the whole thing.
 *
 * Order within each half is the server's aisle order, untouched, so a line does
 * not jump position when it crosses over.
 *
 * `isInCart` exists for the crossing itself: a client that animates a ticked
 * line out of the walk needs it to stay where it is until the animation ends,
 * which is a statement about *when* a line has moved, not whether it is
 * checked. Defaults to the plain reading.
 */
export function partitionCart<T extends CartLine>(
  lines: readonly T[],
  isInCart: (line: T) => boolean = (line) => line.checked,
): { toBuy: T[]; inCart: T[] } {
  const toBuy: T[] = [];
  const inCart: T[] = [];
  for (const line of lines) (isInCart(line) ? inCart : toBuy).push(line);
  return { toBuy, inCart };
}

// --- swipe-away (BL-0019) ---
//
// Swipe is an *accelerator*, never the only path to an action: the row keeps
// its ordinary button, because a gesture is invisible, unavailable to a
// keyboard, and unreliable for anyone whose hands are full of shopping. These
// constants and the reducer below are here rather than in the component so the
// thresholds can be tested without a DOM — the gesture is a decision about two
// numbers, and only the drawing of it is a web concern.

/** How far left the row must travel before letting go deletes it. */
export const SWIPE_COMMIT_PX = 96;

/**
 * Movement below this is not yet a swipe. Without it, the tiny drag inside an
 * ordinary tap would start sliding the row out from under the finger — and the
 * primary interaction on this list is a tap.
 */
export const SWIPE_SLOP_PX = 12;

/** How far the row can be dragged, so it never leaves the screen mid-gesture. */
export const SWIPE_MAX_PX = 140;

export type SwipeState = {
  /** Pixels to shift the row by; always ≤ 0, because the gesture is leftward. */
  offset: number;
  /** True once the gesture is horizontal enough to own the pointer. */
  engaged: boolean;
  /** True when letting go here should delete the row. */
  willDelete: boolean;
};

/**
 * Where a drag of (dx, dy) has got to.
 *
 * Vertical dominance loses: a mostly-up-and-down drag is the page being
 * scrolled, and stealing it would make a long list unscrollable on the exact
 * device this feature is for. A rightward drag does nothing — one direction,
 * one meaning.
 */
export function trackSwipe(dx: number, dy: number): SwipeState {
  const engaged = Math.abs(dx) > SWIPE_SLOP_PX && Math.abs(dx) > Math.abs(dy);
  if (!engaged || dx > 0) return { offset: 0, engaged, willDelete: false };
  const offset = Math.max(dx, -SWIPE_MAX_PX);
  return { offset, engaged, willDelete: -offset >= SWIPE_COMMIT_PX };
}

// --- live sync (BL-0019) ---

/** The parts of a line a second shopper can change under you. */
export type SyncableLine = { _id: string; checked: boolean; quantity: number };

/**
 * Which lines changed between two renders of the list.
 *
 * Convex already re-renders on a remote write, so the list is *correct* the
 * moment someone else ticks something off — but silently. On a phone in a shop
 * that reads as the list mutating on its own. The caller subtracts the changes
 * it made itself and flashes the rest, which is the whole acknowledgement.
 *
 * A line that appears out of nowhere counts as a change (someone added it); one
 * that disappears cannot be highlighted, so it does not.
 */
export function changedLineIds(
  prev: readonly SyncableLine[],
  next: readonly SyncableLine[],
): string[] {
  const before = new Map(prev.map((line) => [line._id, line]));
  const changed: string[] = [];
  for (const line of next) {
    const was = before.get(line._id);
    if (was === undefined) {
      changed.push(line._id);
    } else if (was.checked !== line.checked || was.quantity !== line.quantity) {
      changed.push(line._id);
    }
  }
  return changed;
}

/** The purchase half of a grocery line — see `GroceryPurchase` in @pantry/types. */
export type PurchasedLine = {
  quantity: number;
  unit: string;
  purchase?: { quantity: number; unit: string; residue?: number; residueUnit?: string };
};

/**
 * Pluralizes a pack unit for a quantity ("bunch" -> "bunches").
 *
 * Pack units are stored singular because the dataset states a fact about one
 * pack, and this is the presentation rule every client shares — a naive `+ "s"`
 * in one UI would read "2 bunchs" while another read it correctly. The sibilant
 * rule (-s/-x/-ch/-sh take -es) covers every unit the dataset uses; anything
 * needing an irregular plural does not belong in it.
 */
export function pluralizeUnit(unit: string, quantity: number): string {
  if (unit === "" || quantity === 1) return unit;
  return /(?:s|x|ch|sh)$/.test(unit) ? `${unit}es` : `${unit}s`;
}

/**
 * How to say what to buy for a line: the pack when we know it, the recipe's own
 * measure when we do not.
 *
 * `need` is only returned when it differs from what is being bought — repeating
 * "1 bunch (needs 1 bunch)" is noise, and the whole reason to show the need at
 * all is that it does not match what the shop sells.
 */
export function purchaseText(
  line: PurchasedLine,
  format: (n: number) => string,
): { buy: string; need?: string } {
  const measure = `${format(line.quantity)} ${line.unit}`.trim();
  if (!line.purchase) return { buy: measure };
  const { quantity, unit } = line.purchase;
  return { buy: `${format(quantity)} ${pluralizeUnit(unit, quantity)}`.trim(), need: measure };
}

/**
 * "6 tbsp" — the surplus a confirmed leftover is about. Empty when there is none.
 *
 * The residue is expressed in a MEASURE unit (tbsp, cup, g), which is an
 * abbreviation and never pluralizes — unlike the pack unit above. The one case
 * where the two coincide is a residue counted in packs ("½ bunch"), and a
 * fraction of a pack is still singular there.
 */
export function residueText(
  purchase: PurchasedLine["purchase"],
  format: (n: number) => string,
): string {
  if (!purchase?.residue) return "";
  return `${format(purchase.residue)} ${purchase.residueUnit ?? ""}`.trim();
}
