/**
 * Generates `_generated/tailwind-theme.js` — the `theme.extend` object for
 * NativeWind — from the `@pantry/design-tokens` data.
 *
 * This is the mobile twin of `apps/web/scripts/generate-theme-css.mjs`. Web
 * renders the tokens as a Tailwind v4 `@theme` block; NativeWind is Tailwind v3
 * and wants a JS object, so the same data is rendered twice rather than the
 * palette being hand-copied into a second place.
 *
 * The output is checked in, so Metro and `jest` need no codegen step, and CJS
 * so `tailwind.config.js` can `require()` it without ESM interop. It lives under
 * `_generated/` because `biome.json` already excludes that directory everywhere
 * — otherwise the formatter and this script would fight over the same file.
 *
 * Scale groups beyond colour (spacing, radii, typography — BL-0053) are picked
 * up automatically as `@pantry/design-tokens` starts exporting them: this reads
 * whatever of the known exports exists. That means the `--check` run below
 * *fails* the first time mobile is built after BL-0053 lands, which is the
 * intended prompt to regenerate and adopt.
 *
 *   node scripts/generate-tailwind-theme.mjs           # write
 *   node scripts/generate-tailwind-theme.mjs --check   # verify, exit 1 on drift
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as tokenExports from "@pantry/design-tokens";

// Spread once into a plain object: repeated dynamic access on a module
// namespace defeats bundler analysis, and Biome rejects it.
const tokens = { ...tokenExports };

/**
 * Token export -> Tailwind `theme.extend` key. Entries whose export does not
 * exist yet are skipped, so this list can name BL-0053's groups before it lands.
 */
const TOKEN_GROUPS = [
  ["colorTokens", "colors"],
  ["spacingTokens", "spacing"],
  ["radiusTokens", "borderRadius"],
  ["fontSizeTokens", "fontSize"],
  ["fontWeightTokens", "fontWeight"],
];

const BANNER = `// Generated from @pantry/design-tokens — do not edit by hand.
// Run \`pnpm --filter @pantry/mobile tokens:tailwind\` after changing a token.`;

function render() {
  const groups = TOKEN_GROUPS.filter(([exportName]) => tokens[exportName] !== undefined).map(
    ([exportName, themeKey]) =>
      `  ${themeKey}: ${JSON.stringify(tokens[exportName], null, 2).replace(/\n/g, "\n  ")},`,
  );

  return `${BANNER}\n\nmodule.exports = {\n${groups.join("\n")}\n};\n`;
}

const target = fileURLToPath(new URL("../_generated/tailwind-theme.js", import.meta.url));
const rendered = render();

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(target, "utf8");
  } catch {
    // Missing file reads as empty, which fails the comparison below.
  }

  if (current !== rendered) {
    console.error(
      `${target} is out of date with @pantry/design-tokens.\n` +
        "Run `pnpm --filter @pantry/mobile tokens:tailwind` and commit the result.",
    );
    process.exit(1);
  }

  console.log("design tokens: _generated/tailwind-theme.js is up to date");
} else {
  writeFileSync(target, rendered, "utf8");
  console.log(`design tokens → ${target}`);
}
