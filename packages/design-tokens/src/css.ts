import { type ColorToken, colorTokens, colorTokenVariable } from "./colors.js";

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
 * matching utility classes, so this output is what makes `bg-surface` &c. work.
 */
export function renderThemeCss(): string {
  const declarations = (Object.keys(colorTokens) as ColorToken[])
    .map((token) => `  ${colorTokenVariable(token)}: ${colorTokens[token]};`)
    .join("\n");

  return `${GENERATED_CSS_BANNER}\n\n@theme {\n${declarations}\n}\n`;
}
