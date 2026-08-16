/**
 * The NativeWind <- design-tokens binding.
 *
 * `scripts/generate-tailwind-theme.mjs --check` already fails on a stale
 * generated file. This checks the other half: that each token group is bound to
 * the Tailwind key that actually drives the utilities, in the shape Tailwind
 * expects. A group mapped to the wrong key, or handed the wrong shape, produces
 * *no error at all* — the utility silently falls back to Tailwind's default
 * scale, and the app looks almost right.
 */
import {
  colorTokens,
  fontSizeTokens,
  fontWeightTokens,
  radiusTokens,
  spacingTokens,
} from "@pantry/design-tokens";

const theme = (require("./tailwind.config") as { theme: { extend: Record<string, unknown> } }).theme
  .extend;

describe("tailwind theme", () => {
  it("binds the palette to `colors`", () => {
    expect(theme.colors).toEqual(colorTokens);
  });

  it("binds the spacing scale, so p-4 and gap-2 are token values", () => {
    expect(theme.spacing).toEqual(spacingTokens);
  });

  it("binds radii to `borderRadius`", () => {
    expect(theme.borderRadius).toEqual(radiusTokens);
  });

  it("binds font weights", () => {
    expect(theme.fontWeight).toEqual(fontWeightTokens);
  });

  it("reshapes font sizes into Tailwind's [size, { lineHeight }] tuple", () => {
    // The token is a `{ fontSize, lineHeight }` record. Passing it through
    // unchanged makes Tailwind treat it as an arbitrary value and emit no line
    // height — text renders at the right size with the wrong leading.
    expect(theme.fontSize).toEqual({
      xs: ["0.75rem", { lineHeight: "1rem" }],
      sm: ["0.875rem", { lineHeight: "1.25rem" }],
      base: ["1rem", { lineHeight: "1.5rem" }],
      lg: ["1.125rem", { lineHeight: "1.75rem" }],
      xl: ["1.25rem", { lineHeight: "1.75rem" }],
      "2xl": ["1.5rem", { lineHeight: "2rem" }],
    });
  });

  it("covers every size the tokens define", () => {
    expect(Object.keys(theme.fontSize as object)).toEqual(Object.keys(fontSizeTokens));
  });

  it("styles the app from tokens only — every utility used resolves to one", () => {
    // Guards against reaching for a step the scale does not define, which
    // Tailwind resolves from its own defaults without complaint.
    const used = { spacing: ["2", "3", "4", "6"], borderRadius: ["lg"], fontWeight: ["semibold"] };

    for (const [key, steps] of Object.entries(used)) {
      for (const step of steps) {
        expect({ key, step, present: step in (theme[key] as object) }).toEqual({
          key,
          step,
          present: true,
        });
      }
    }
  });
});
