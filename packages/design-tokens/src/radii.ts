/**
 * Pantry's border-radius scale — the steps `apps/web` actually uses.
 *
 * Keys are Tailwind's radius names: `lg` is the CSS variable `--radius-lg` and
 * the utilities `rounded-lg`, `rounded-t-lg`, ...
 *
 * Two radius utilities in `apps/web` deliberately have no token here, because
 * Tailwind does not resolve them through this namespace:
 *
 * - `rounded-full` is a static utility (`calc(infinity * 1px)`), not a scale
 *   value. A native client should treat it as "pill", not as a length.
 * - bare `rounded` / `rounded-t` resolve to Tailwind's deprecated `--radius`
 *   variable, which is `0.25rem` — the same value as `sm`. They are left alone
 *   rather than migrated, because rewriting them to `rounded-sm` is a source
 *   change and BL-0053 must not change the rendered output.
 */
export const radiusTokens = {
  sm: "0.25rem",
  md: "0.375rem",
  lg: "0.5rem",
  xl: "0.75rem",
} as const;

/** Name of a radius token, e.g. `"lg"`. */
export type RadiusToken = keyof typeof radiusTokens;

/** The CSS custom property a radius token renders to, e.g. `--radius-lg`. */
export function radiusTokenVariable(token: RadiusToken): string {
  return `--radius-${token}`;
}
