/**
 * Generates `src/theme.generated.css` — the Tailwind `@theme` rule — from the
 * `@pantry/design-tokens` data.
 *
 * The output is checked in so `vite dev` / `vite build` need no codegen step.
 * `--check` re-renders and compares instead of writing; it runs as part of
 * `pnpm --filter @pantry/web test` so a token edit that skips the generator
 * fails CI rather than silently shipping a stale stylesheet.
 *
 *   node scripts/generate-theme-css.mjs           # write
 *   node scripts/generate-theme-css.mjs --check   # verify, exit 1 on drift
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderThemeCss } from "@pantry/design-tokens";

const target = fileURLToPath(new URL("../src/theme.generated.css", import.meta.url));
const rendered = renderThemeCss();

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
        "Run `pnpm --filter @pantry/web tokens:css` and commit the result.",
    );
    process.exit(1);
  }

  console.log("design tokens: theme.generated.css is up to date");
} else {
  writeFileSync(target, rendered, "utf8");
  console.log(`design tokens → ${target}`);
}
