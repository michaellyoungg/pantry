const generatedTheme = require("./_generated/tailwind-theme");

/**
 * NativeWind is Tailwind v3, so this config is the mobile counterpart of the
 * web app's Tailwind v4 `@theme` block. Both are generated from
 * `@pantry/design-tokens`; neither hand-copies a value.
 *
 * @type {import('tailwindcss').Config}
 */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: generatedTheme,
  },
  plugins: [],
};
