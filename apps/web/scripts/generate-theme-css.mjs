/**
 * Generates `src/theme.generated.css` — the Tailwind `@theme` rule — from the
 * `@pantry/design-tokens` data.
 *
 * The output is checked in so `vite dev` / `vite build` need no codegen step.
 * `--check` re-renders and compares instead of writing; it runs as part of
 * `pnpm --filter @pantry/web test` so a token edit that skips the generator
 * fails CI rather than silently shipping a stale stylesheet.
 *
 * This is a script rather than a vitest test on purpose: the natural way to
 * write it as a test is to `import theme from "../src/theme.generated.css?raw"`,
 * and the web suite runs with `css: false`, which makes every `?raw` stylesheet
 * import resolve to the empty string. The assertion would pass against nothing.
 *
 *   node scripts/generate-theme-css.mjs           # write
 *   node scripts/generate-theme-css.mjs --check   # verify, exit 1 on drift
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderThemeCss, spacingScaleProblems } from "@pantry/design-tokens";

const target = fileURLToPath(new URL("../src/theme.generated.css", import.meta.url));
const rendered = renderThemeCss();

if (process.argv.includes("--check")) {
  // The spacing scale is checked first because the stylesheet cannot reveal it.
  // Tailwind derives every web spacing utility from the `--spacing` multiplier,
  // so a per-step literal that disagrees with the base regenerates cleanly and
  // is invisible until a native client renders against it (BL-0053).
  const problems = spacingScaleProblems();

  if (problems.length > 0) {
    console.error(
      "@pantry/design-tokens: spacing scale is internally inconsistent.\n" +
        problems.map((problem) => `  - ${problem}`).join("\n"),
    );
    process.exit(1);
  }

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

  console.log("design tokens: spacing scale consistent, theme.generated.css is up to date");
} else {
  writeFileSync(target, rendered, "utf8");
  console.log(`design tokens → ${target}`);
}
