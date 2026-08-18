/**
 * How old the cached list is, in the roughest units that are still true.
 *
 * Its own module rather than a second export from `OfflineBanner`, which is the
 * shape the offline banner would otherwise take: a file that exports both a
 * component and a helper breaks fast refresh, and the reasoning below is about
 * sync recency rather than about how the banner is drawn.
 *
 * `now` is passed in rather than read, so the rounding can be asserted at every
 * boundary without a fake clock.
 */
export function lastSyncedLabel(syncedAt: number | null, now: number): string {
  if (syncedAt === null) return "not synced yet";
  // A phone whose clock moved while it was offline is not a reason to tell the
  // shopper their list is four hundred hours old.
  const minutes = Math.floor(Math.max(0, now - syncedAt) / 60_000);
  if (minutes < 1) return "up to date a moment ago";
  if (minutes < 60) return `up to date ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return hours === 1 ? "up to date an hour ago" : `up to date ${hours} hours ago`;
}
