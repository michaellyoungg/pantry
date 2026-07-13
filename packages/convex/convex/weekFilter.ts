type BasketEntry = {
  recipeId: string;
  plannedDate?: string;
  servingsMultiplier?: number;
  type?: "meal" | "leftover";
};

// Adds `days` to a "YYYY-MM-DD" date via UTC to avoid DST surprises.
function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// The meals to shop for in the Sun–Sat week starting at `weekStart`: only
// scheduled, non-leftover entries within the week, each with its multiplier.
export function planItemsForWeek(
  entries: BasketEntry[],
  weekStart: string,
): Array<{ recipeId: string; multiplier: number }> {
  const weekEnd = addDays(weekStart, 6);
  return entries
    .filter(
      (e) =>
        e.type !== "leftover" &&
        e.plannedDate !== undefined &&
        e.plannedDate >= weekStart &&
        e.plannedDate <= weekEnd,
    )
    .map((e) => ({ recipeId: e.recipeId, multiplier: e.servingsMultiplier ?? 1 }));
}
