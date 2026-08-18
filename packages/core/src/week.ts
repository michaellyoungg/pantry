// The week runs Mon…Sun to match the schema's `basket.weekday` (0=Mon … 6=Sun).
export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export const DAY_FULL = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

/**
 * Which bucket a real date falls in, 0=Mon … 6=Sun.
 *
 * `Date#getDay()` counts from Sunday, so every caller that wants the planner's
 * indexing has to shift it. Doing that inline is how a week silently starts on
 * the wrong day in one place and not another, so the shift is named once here.
 */
export function weekdayOf(date: Date): number {
  return (date.getDay() + 6) % 7;
}
