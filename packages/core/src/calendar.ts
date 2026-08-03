/**
 * Calendar-date arithmetic on `YYYY-MM-DD` strings.
 *
 * Everything here works on the *local* calendar day. `Date#toISOString()` is
 * deliberately avoided: it converts to UTC first, so a meal cooked at 8pm in
 * UTC-5 would be filed under the following day. The log's `date` is the day the
 * user experienced, not an instant.
 */

/** An inclusive range of calendar days. */
export interface DateRange {
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** The local calendar day of `date`, as `YYYY-MM-DD`. */
export function toISODate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Parses `YYYY-MM-DD` as local midnight. Throws on anything else. */
export function parseISODate(iso: string): Date {
  if (!ISO_DATE.test(iso)) throw new Error(`not a YYYY-MM-DD date: ${iso}`);
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  // Rejects "2026-02-31" and friends, which Date silently rolls forward.
  if (toISODate(date) !== iso) throw new Error(`not a calendar date: ${iso}`);
  return date;
}

/** `days` after (or, negative, before) an ISO date. */
export function addDays(iso: string, days: number): string {
  const date = parseISODate(iso);
  date.setDate(date.getDate() + days);
  return toISODate(date);
}

/**
 * The Monday of the week containing `iso`.
 *
 * Monday because `basket.weekday` is 0=Mon…6=Sun, so a week start plus a
 * weekday index is the row's calendar date with no further translation.
 */
export function startOfWeek(iso: string): string {
  const date = parseISODate(iso);
  // Date#getDay() is 0=Sun…6=Sat; shift to 0=Mon…6=Sun.
  const mondayIndex = (date.getDay() + 6) % 7;
  return addDays(iso, -mondayIndex);
}

/** The calendar date of `weekday` (0=Mon…6=Sun) within the week starting `weekStart`. */
export function dateForWeekday(weekStart: string, weekday: number): string {
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
    throw new Error(`weekday must be an integer 0..6, got ${weekday}`);
  }
  return addDays(weekStart, weekday);
}

/** Every calendar day in an inclusive range, ascending. Empty if `to` precedes `from`. */
export function datesInRange({ from, to }: DateRange): string[] {
  parseISODate(from);
  parseISODate(to);
  const days: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
  return days;
}

/** The inclusive range of `length` days ending on `end`. */
export function windowEndingOn(end: string, length: number): DateRange {
  if (!Number.isInteger(length) || length < 1) {
    throw new Error(`window length must be a positive integer, got ${length}`);
  }
  return { from: addDays(end, -(length - 1)), to: end };
}
