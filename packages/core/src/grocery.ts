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
