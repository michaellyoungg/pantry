import { type ColorToken, colorTokens, colorTokenVariable } from "./colors.js";
import { type RadiusToken, radiusTokens, radiusTokenVariable } from "./radii.js";
import { SPACING_BASE_REM, SPACING_VARIABLE } from "./spacing.js";
import {
  type FontSizeTokenName,
  type FontWeightToken,
  fontSizeTokens,
  fontSizeTokenVariable,
  fontWeightTokens,
  fontWeightTokenVariable,
  lineHeightRatio,
  lineHeightTokenVariable,
} from "./typography.js";

/**
 * Banner written at the top of generated stylesheets. Deliberately names the
 * command that regenerates them so an editor who ignores the "do not edit"
 * knows where to go instead.
 */
export const GENERATED_CSS_BANNER = `/* Generated from @pantry/design-tokens — do not edit by hand.
   Run \`pnpm --filter @pantry/web tokens:css\` after changing a token. */`;

/**
 * Renders the token data as the Tailwind `@theme` block the web app imports.
 *
 * Tailwind v4 reads `@theme` to build both the CSS custom properties and the
 * matching utility classes, so this output is what makes `bg-surface`,
 * `rounded-lg`, `text-sm` &c. work.
 *
 * `@theme` merges with Tailwind's defaults rather than replacing them, and
 * BL-0053 deliberately emits the *default* value for every non-colour token it
 * extracts. That is not redundancy — it is the point. Naming the values here
 * makes them data a native client can read, and re-declaring them at the value
 * they already had is what guarantees the extraction changes no pixels.
 */
export function renderThemeCss(): string {
  const sections = [
    section("Colour", renderColors()),
    section("Spacing", renderSpacing()),
    section("Border radius", renderRadii()),
    section("Type scale", renderFontSizes()),
    section("Font weight", renderFontWeights()),
  ].join("\n\n");

  return `${GENERATED_CSS_BANNER}\n\n@theme {\n${sections}\n}\n`;
}

function section(title: string, declarations: string): string {
  return `  /* ${title} */\n${declarations}`;
}

function renderColors(): string {
  return (Object.keys(colorTokens) as ColorToken[])
    .map((token) => `  ${colorTokenVariable(token)}: ${colorTokens[token]};`)
    .join("\n");
}

/**
 * Tailwind computes every numeric spacing utility from this one multiplier —
 * `p-2` is `calc(var(--spacing) * 2)` — so the base is the only spacing
 * declaration there is to emit. The per-step values in `spacingTokens` exist
 * for consumers that cannot do that arithmetic themselves.
 */
function renderSpacing(): string {
  return `  ${SPACING_VARIABLE}: ${SPACING_BASE_REM}rem;`;
}

function renderRadii(): string {
  return (Object.keys(radiusTokens) as RadiusToken[])
    .map((token) => `  ${radiusTokenVariable(token)}: ${radiusTokens[token]};`)
    .join("\n");
}

/**
 * Each size emits two properties, matching Tailwind's own shape: the size and
 * the line height it is paired with. The line height is written as the unitless
 * ratio Tailwind ships, not as the absolute value held in the data — see the
 * note in `typography.ts` for why that distinction is load-bearing on the web.
 */
function renderFontSizes(): string {
  return (Object.keys(fontSizeTokens) as FontSizeTokenName[])
    .flatMap((token) => [
      `  ${fontSizeTokenVariable(token)}: ${fontSizeTokens[token].fontSize};`,
      `  ${lineHeightTokenVariable(token)}: ${lineHeightRatio(token)};`,
    ])
    .join("\n");
}

function renderFontWeights(): string {
  return (Object.keys(fontWeightTokens) as FontWeightToken[])
    .map((token) => `  ${fontWeightTokenVariable(token)}: ${fontWeightTokens[token]};`)
    .join("\n");
}
