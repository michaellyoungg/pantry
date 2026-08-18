// Shelf-life presentation (BL-0029). Pure functions over pantry rows so every
// surface that shows the nudge derives the same batch, and so the rules are
// testable without React, Convex or a renderer.
//
// This lives in `@pantry/core` rather than in a client because there are now
// two clients (BL-0059). Web's Home and Pantry screens and the native pantry
// screen all read the same horizon, the same sort order and the same phrasing;
// a second copy of `expiringSoon` would let two platforms disagree about which
// items are about to spoil, which is exactly the drift the headless rule
// exists to prevent.
//
// Every date here is APPROXIMATE: it was computed from a shelf-life table when
// the item entered the pantry, not read off a printed label. The formatting
// below is deliberately relative and tilde-prefixed so nothing in the UI can be
// mistaken for a real use-by date.

const DAY = 86_400_000;

/** How far ahead the "use this week" batch looks. */
export const EXPIRY_HORIZON_DAYS = 7;

export type PantryRow = {
  _id: string;
  display: string;
  canonicalItem: string;
  state: "have" | "low" | "out";
  useBy?: number;
  /**
   * Not used by the expiry rules below, but part of the row every pantry surface
   * reads: the use-it-up card keys its refetch on it, so marking an item to use
   * up re-asks the ranker (BL-0050).
   */
  useItUp?: boolean;
};

/**
 * The batch behind "N items to use this week", soonest first.
 *
 * Rows with no `useBy` are skipped rather than assumed fresh — an unknown item
 * has an unknown shelf life. Rows marked `out` are skipped because the user has
 * already told us the item is gone; only `have` and `low` are still in the
 * fridge going off. Past-due rows stay in: those are the ones that matter most.
 */
export function expiringSoon(rows: readonly PantryRow[], now: number): PantryRow[] {
  const cutoff = now + EXPIRY_HORIZON_DAYS * DAY;
  return rows
    .filter((r) => r.useBy !== undefined && r.state !== "out" && r.useBy <= cutoff)
    .sort((a, b) => (a.useBy ?? 0) - (b.useBy ?? 0));
}

/**
 * Relative, approximate phrasing for a use-by date: `~5 days`, `~today`,
 * `~2 days ago`, `~3 wk`. Never an absolute date — "use by Sep 12" reads like
 * it was copied off a carton, and this number is an estimate from a table.
 * Long horizons coarsen to weeks/months/years so a bag of rice doesn't announce
 * a precise day count it cannot possibly justify.
 */
export function formatUseBy(useBy: number, now: number): string {
  // Whole days remaining, not nearest: 12 hours out is still "today", and
  // anything at all past the date should read as overdue rather than round back
  // to "today".
  const days = Math.floor((useBy - now) / DAY);
  if (days < 0) {
    const past = Math.abs(days);
    return `~${past} ${past === 1 ? "day" : "days"} ago`;
  }
  if (days === 0) return "~today";
  if (days === 1) return "~tomorrow";
  if (days < 14) return `~${days} days`;
  if (days < 60) return `~${Math.round(days / 7)} wk`;
  if (days < 365) return `~${Math.round(days / 30)} mo`;
  return `~${Math.round(days / 365)} yr`;
}

/** True when an item is at or past its approximate date. */
export function isOverdue(useBy: number, now: number): boolean {
  return useBy <= now;
}
