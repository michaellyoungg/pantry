/**
 * Pantry's type scale — the font sizes, paired line heights and weights
 * `apps/web` actually uses.
 *
 * Keys are Tailwind's names: `sm` is `--text-sm` and the utility `text-sm`;
 * `semibold` is `--font-weight-semibold` and the utility `font-semibold`.
 *
 * ## Why `lineHeight` is absolute here but a ratio in CSS
 *
 * Tailwind pairs every `text-*` utility with a default line height, written as
 * an unadorned ratio: `--text-sm--line-height: calc(1.25 / 0.875)`. The ratio
 * form matters on the web, because `line-height` inherits, and a unitless value
 * is re-resolved against each descendant's own font size. `apps/web` has
 * elements that set a font size without setting a line height — the arbitrary
 * `text-[10px]` and `text-[0.65rem]` badges — so switching the CSS to an
 * absolute length would change what those inherit, and therefore how they
 * render. `renderThemeCss` keeps emitting the ratio for exactly that reason.
 *
 * The ratio is a poor thing to hand a native runtime, though: React Native's
 * `lineHeight` is an absolute number, and there is no inheritance to re-resolve
 * against. So the data stores the absolute value, which is also how Tailwind
 * documents the scale (`text-sm` is "0.875rem / 1.25rem"), and the CSS
 * generator divides the pair back into the ratio Tailwind ships. The two are
 * the same leading expressed two ways, not two decisions.
 */

/** A font size and the line height Tailwind pairs with it, both in `rem`. */
export interface FontSizeToken {
  readonly fontSize: string;
  readonly lineHeight: string;
}

export const fontSizeTokens = {
  xs: { fontSize: "0.75rem", lineHeight: "1rem" },
  sm: { fontSize: "0.875rem", lineHeight: "1.25rem" },
  base: { fontSize: "1rem", lineHeight: "1.5rem" },
  lg: { fontSize: "1.125rem", lineHeight: "1.75rem" },
  xl: { fontSize: "1.25rem", lineHeight: "1.75rem" },
  "2xl": { fontSize: "1.5rem", lineHeight: "2rem" },
} as const satisfies Record<string, FontSizeToken>;

/** Name of a font-size token, e.g. `"2xl"`. */
export type FontSizeTokenName = keyof typeof fontSizeTokens;

/** The CSS custom property a font-size token renders to, e.g. `--text-sm`. */
export function fontSizeTokenVariable(token: FontSizeTokenName): string {
  return `--text-${token}`;
}

/**
 * The companion custom property carrying the paired line height, e.g.
 * `--text-sm--line-height`. Tailwind's own naming, double dash included.
 */
export function lineHeightTokenVariable(token: FontSizeTokenName): string {
  return `--text-${token}--line-height`;
}

/**
 * The paired line height as the unitless ratio Tailwind's own theme uses —
 * `1.25rem` over `0.875rem` becomes `1.25 / 0.875`. Kept as a numeric string
 * pair rather than a computed decimal so the generated CSS is byte-identical to
 * the Tailwind default it replaces (see the note at the top of this file).
 */
export function lineHeightRatio(token: FontSizeTokenName): string {
  const { fontSize, lineHeight } = fontSizeTokens[token];
  return `calc(${stripRem(lineHeight)} / ${stripRem(fontSize)})`;
}

function stripRem(value: string): string {
  return value.endsWith("rem") ? value.slice(0, -"rem".length) : value;
}

/**
 * Weights `apps/web` uses. `normal` is here despite being the CSS initial value
 * because the app spells it out to undo a bolder weight from an ancestor.
 */
export const fontWeightTokens = {
  normal: "400",
  medium: "500",
  semibold: "600",
  bold: "700",
  black: "900",
} as const;

/** Name of a font-weight token, e.g. `"semibold"`. */
export type FontWeightToken = keyof typeof fontWeightTokens;

/** The CSS custom property a weight token renders to, e.g. `--font-weight-bold`. */
export function fontWeightTokenVariable(token: FontWeightToken): string {
  return `--font-weight-${token}`;
}
