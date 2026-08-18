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

/** Which bucket a local date falls in, 0=Mon … 6=Sun — `getDay()`, shifted. */
export function weekdayOf(date: Date): number {
  return (date.getDay() + 6) % 7;
}
