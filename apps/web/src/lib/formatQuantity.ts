// Renders a numeric quantity as a shopping-friendly string: nice fractions
// become glyphs (0.75 -> "¾", 1.5 -> "1½"), whole numbers stay plain, and
// anything else falls back to a trimmed 2-decimal number. Mirrors the
// nice-value set recipe-service uses to choose display units, so the unit and
// the glyph always agree.
const EPSILON = 0.02;
const FRACTIONS: Array<[value: number, glyph: string]> = [
  [0.25, "¼"],
  [1 / 3, "⅓"],
  [0.5, "½"],
  [2 / 3, "⅔"],
  [0.75, "¾"],
];

export function formatQuantity(n: number): string {
  const whole = Math.floor(n);
  const frac = n - whole;
  for (const [value, glyph] of FRACTIONS) {
    if (Math.abs(frac - value) <= EPSILON) {
      return whole === 0 ? glyph : `${whole}${glyph}`;
    }
  }
  if (Math.abs(frac) <= EPSILON) return String(whole);
  return String(Math.round(n * 100) / 100);
}
