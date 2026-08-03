/**
 * Pantry's colour palette — the single source of truth.
 *
 * These values used to be literals in the `@theme` block of
 * `apps/web/src/index.css`, which made them readable only by CSS. Keeping them
 * as data lets a second client (NativeWind, see
 * `docs/superpowers/specs/2026-07-18-mobile-client-design.md`) consume the same
 * palette instead of hand-copying it.
 *
 * Keys are the Tailwind colour names: token `primary` is the CSS variable
 * `--color-primary` and the utility classes `bg-primary`, `text-primary`, ...
 * Adding a token here and re-running the generator (see `renderThemeCss`) is
 * all it takes for the web app to pick it up.
 */
export const colorTokens = {
  bg: "#faf7f2",
  surface: "#ffffff",
  border: "#e7e5e4",
  primary: "#3f7d4e",
  "primary-hover": "#356b43",
  danger: "#c0562f",
  "danger-hover": "#a8481f",
  text: "#292524",
  muted: "#78716c",
} as const;

/** Name of a colour token, e.g. `"primary-hover"`. */
export type ColorToken = keyof typeof colorTokens;

/** The CSS custom property a colour token renders to, e.g. `--color-primary`. */
export function colorTokenVariable(token: ColorToken): string {
  return `--color-${token}`;
}
