// Reading what a shopper typed into the "add an item" box.
//
// One field, not three: standing in an aisle you type "2 lb butter", not
// tab-tab-tab. Splitting that back into quantity/unit/item is the price of the
// single field, and it is pure string work, so it belongs here rather than in a
// component.

/**
 * The measure words we will lift out of typed text.
 *
 * Deliberately exactly recipe-service's convertible-unit vocabulary
 * (`units` in `normalization.json`) rather than a wider guess: that table is the
 * only authority on what counts as a unit, and inventing extra ones here would
 * be a second vocabulary to drift. Anything not listed stays part of the item
 * name ("2 cloves garlic" buys "cloves garlic"), which reads a little oddly but
 * is visible and editable, where swallowing a word into the unit is neither.
 */
const MEASURE_UNITS = new Set(["cup", "g", "kg", "l", "lb", "ml", "oz", "tbsp", "tsp"]);

/** Fraction glyphs, because the list renders quantities with them (¾ cup) and
 * re-typing what you just read should work. */
const FRACTION_GLYPHS: Record<string, number> = {
  "¼": 0.25,
  "½": 0.5,
  "¾": 0.75,
  "⅓": 1 / 3,
  "⅔": 2 / 3,
  "⅛": 0.125,
};

export type ManualEntry = {
  /** Always at least 1: "0 milk" is not something anyone means to ask for. */
  quantity: number;
  /** A measure word from MEASURE_UNITS, or "" when the item is just counted. */
  unit: string;
  /** What to buy. Empty only for blank input — callers should reject that. */
  item: string;
};

/** Parses one token as a number, a written fraction, or a fraction glyph. */
function numeric(token: string): number | null {
  if (FRACTION_GLYPHS[token] !== undefined) return FRACTION_GLYPHS[token];
  const fraction = /^(\d+)\/(\d+)$/.exec(token);
  if (fraction) {
    const denominator = Number(fraction[2]);
    return denominator === 0 ? null : Number(fraction[1]) / denominator;
  }
  return /^\d+(\.\d+)?$/.test(token) ? Number(token) : null;
}

/** Folds a typed measure word to the singular form the unit table uses. */
function measureUnit(token: string | undefined): string | null {
  if (token === undefined) return null;
  const lower = token.toLowerCase();
  if (MEASURE_UNITS.has(lower)) return lower;
  const singular = lower.endsWith("s") ? lower.slice(0, -1) : null;
  return singular !== null && MEASURE_UNITS.has(singular) ? singular : null;
}

export function parseManualEntry(text: string): ManualEntry {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { quantity: 1, unit: "", item: "" };

  // "500g" — a unit written flush against the number. Only split when the
  // letters really are a unit, so "7up" stays a drink rather than becoming 7 of
  // something called "up".
  const flush = /^(\d+(?:\.\d+)?)([a-z]+)$/i.exec(tokens[0]);
  if (flush && measureUnit(flush[2]) !== null && tokens.length > 1) {
    return {
      quantity: positive(Number(flush[1])),
      unit: measureUnit(flush[2]) as string,
      item: tokens.slice(1).join(" "),
    };
  }

  let quantity = numeric(tokens[0]);
  let rest = quantity === null ? tokens : tokens.slice(1);
  // "1 1/2 lb beef" — a whole number followed by a fraction is one amount.
  if (quantity !== null && Number.isInteger(quantity) && rest.length > 0) {
    const fraction = numeric(rest[0]);
    if (fraction !== null && fraction < 1) {
      quantity += fraction;
      rest = rest.slice(1);
    }
  }

  // A measure word only counts as one when something is named after it;
  // otherwise "2 lb" would leave a line with nothing on it.
  const unit = rest.length > 1 ? measureUnit(rest[0]) : null;
  if (unit !== null) rest = rest.slice(1);

  return { quantity: positive(quantity), unit: unit ?? "", item: rest.join(" ") };
}

/** Falls back to one for a missing or non-positive amount. Fractions are real
 * amounts and pass through — only "0 milk" (and worse) is nonsense. */
function positive(quantity: number | null): number {
  return quantity === null || quantity <= 0 ? 1 : quantity;
}
