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
