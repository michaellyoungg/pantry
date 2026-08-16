/**
 * Pantry's spacing scale — the steps `apps/web` actually uses.
 *
 * Tailwind v4 does not ship a per-step spacing scale. It ships a single base
 * multiplier (`--spacing`) and computes every numeric utility from it, so
 * `p-2` compiles to `calc(var(--spacing) * 2)`. That is why the generated
 * `@theme` block below emits only `--spacing`: it is the whole of what the web
 * app relies on, and re-declaring it at its default value leaves the compiled
 * stylesheet byte-identical.
 *
 * A native runtime cannot do that arithmetic for us — NativeWind wants concrete
 * values — so the steps are also spelled out here as data. `spacing.test.ts`
 * asserts every literal equals `step * SPACING_BASE_REM`, so the two can never
 * disagree.
 *
 * The keys are Tailwind's step numbers, i.e. `spacingTokens["1.5"]` is what
 * `p-1.5` / `gap-1.5` resolve to. Only steps `apps/web` uses are listed
 * (BL-0053 is an extraction, not a redesign); add a step here when the web app
 * starts using it.
 */

/** The multiplier every numeric spacing utility is computed from. */
export const SPACING_BASE_REM = 0.25;

/** The CSS custom property the base multiplier renders to. */
export const SPACING_VARIABLE = "--spacing";

export const spacingTokens = {
  "0": "0rem",
  "0.5": "0.125rem",
  "1": "0.25rem",
  "1.5": "0.375rem",
  "2": "0.5rem",
  "2.5": "0.625rem",
  "3": "0.75rem",
  "3.5": "0.875rem",
  "4": "1rem",
  "5": "1.25rem",
  "6": "1.5rem",
  "8": "2rem",
  "11": "2.75rem",
  "16": "4rem",
  "20": "5rem",
  "24": "6rem",
  "28": "7rem",
  "40": "10rem",
  "56": "14rem",
} as const;

/** A spacing step, e.g. `"1.5"` for the `p-1.5` utility. */
export type SpacingToken = keyof typeof spacingTokens;

/**
 * Reports spacing literals that disagree with `step * SPACING_BASE_REM`.
 *
 * The generated stylesheet cannot catch this. Tailwind computes web spacing
 * from the base multiplier alone, so a mistyped literal above — `"11"` written
 * as `2.5rem` instead of `2.75rem` — regenerates cleanly, renders identically
 * on the web, and only shows up as a native client that is subtly out of
 * register with the web one. That is precisely the drift BL-0053 exists to
 * prevent, so the drift guard checks it (see
 * `apps/web/scripts/generate-theme-css.mjs`).
 *
 * Returns a human-readable problem per bad entry; an empty array means clean.
 */
export function spacingScaleProblems(): string[] {
  const problems: string[] = [];

  for (const [step, value] of Object.entries(spacingTokens)) {
    const expected = `${roundRem(Number(step) * SPACING_BASE_REM)}rem`;
    if (value !== expected) {
      problems.push(
        `spacingTokens["${step}"] is ${value}, but step ${step} × ${SPACING_BASE_REM}rem is ${expected}`,
      );
    }
  }

  return problems;
}

/**
 * Trims the binary-floating-point tail off a rem value (0.375 survives,
 * 0.30000000000000004 does not) without turning whole numbers into "1.000".
 */
function roundRem(value: number): string {
  return String(Number(value.toFixed(4)));
}
