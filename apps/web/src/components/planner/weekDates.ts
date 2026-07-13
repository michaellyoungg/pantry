const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function parts(iso: string): [number, number, number] {
  const [y, m, d] = iso.split("-").map(Number);
  return [y, m, d];
}

export function addDays(iso: string, n: number): string {
  const [y, m, d] = parts(iso);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function sundayOf(iso: string): string {
  const [y, m, d] = parts(iso);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun
  return addDays(iso, -dow);
}

export function weekDays(sunday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(sunday, i));
}

export function weekdayLabel(iso: string): string {
  const [y, m, d] = parts(iso);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

export function formatWeekLabel(sunday: string): string {
  const end = addDays(sunday, 6);
  const [, sm, sd] = parts(sunday);
  const [, em, ed] = parts(end);
  const left = `${MONTHS[sm - 1]} ${sd}`;
  const right = sm === em ? `${ed}` : `${MONTHS[em - 1]} ${ed}`;
  return `${left} – ${right}`;
}
