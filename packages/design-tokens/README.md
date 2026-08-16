# @pantry/design-tokens

Pantry's design tokens as data — the single source of truth for the palette
(BL-0025) and, since BL-0053, for spacing, border radii and the type scale.

The values used to be literals in the `@theme` block of
`apps/web/src/index.css`, or — for everything except colour — not written down
anywhere, because they were Tailwind defaults referenced by utility class. Both
forms are readable only by CSS. A second client would have had to hand-copy
them, and a copied scale drifts visibly.

## What is in here

| Export | Covers | Tailwind namespace |
|---|---|---|
| `colorTokens` | the palette | `--color-*` |
| `spacingTokens`, `SPACING_BASE_REM` | the spacing steps the web app uses | `--spacing` |
| `radiusTokens` | border radii | `--radius-*` |
| `fontSizeTokens` | font sizes and their paired line heights | `--text-*` |
| `fontWeightTokens` | font weights | `--font-weight-*` |

Scope is deliberately narrow: **only tokens `apps/web` already relies on.** This
package records the design system that exists, it does not propose one. Add a
value when a screen starts using it, not in anticipation.

## How the web app consumes them

`apps/web/src/theme.generated.css` is generated from this package and imported
by `apps/web/src/index.css`. It is checked in, so `vite dev` and `vite build`
need no codegen step. The generated stylesheet lives in `apps/web` rather than
here on purpose — a stylesheet under `packages/` puts this package inside
Tailwind's scan set, and it starts emitting utilities for the source text of
these very files.

```bash
pnpm --filter @pantry/web tokens:css   # regenerate after changing a token
```

`pnpm --filter @pantry/web test` runs the generator in `--check` mode, so a
token edit that skips regeneration fails CI instead of shipping a stale
stylesheet. `--check` also verifies the spacing scale against its own base
multiplier — see "Spacing is the odd one out" below.

The guard is a script rather than a vitest test because the obvious test —
importing `theme.generated.css?raw` and asserting on it — passes against the
empty string: the web suite runs with `css: false`, which resolves every `?raw`
stylesheet import to `""`.

## How a native client would consume them

Import the data directly — no CSS involved. Every export is a plain object of
strings, so nothing here needs a CSS engine to interpret:

```ts
import { colorTokens, radiusTokens, spacingTokens } from "@pantry/design-tokens";

// NativeWind theme config
const theme = {
  colors: { ...colorTokens },
  spacing: { ...spacingTokens },
  borderRadius: { ...radiusTokens },
};
```

See `docs/superpowers/specs/2026-08-16-mobile-client-parity-design.md`.

### Spacing is the odd one out

Tailwind v4 has no per-step spacing scale. It has a single base multiplier and
computes every numeric utility from it, so `p-2` compiles to
`calc(var(--spacing) * 2)`. The generated `@theme` therefore emits only
`--spacing` — that really is all the web app relies on.

A native runtime cannot do that arithmetic, so `spacingTokens` spells the steps
out. Because the web never reads those literals, a typo in one is invisible on
the web and shows up only as a native client that is subtly out of register.
`spacingScaleProblems()` catches it, and the `--check` drift guard calls it.

### Line height is stored absolute and emitted as a ratio

`fontSizeTokens.sm` is `{ fontSize: "0.875rem", lineHeight: "1.25rem" }`, but
the generated CSS emits `--text-sm--line-height: calc(1.25 / 0.875)`. Those are
the same leading written two ways, and the difference is load-bearing:

- On the web, `line-height` inherits, and a unitless value is re-resolved
  against each descendant's own font size. `apps/web` has elements that set a
  font size without a line height (`text-[10px]`, `text-[0.65rem]`), so an
  absolute length would change what they inherit — and therefore what renders.
- In React Native there is no such inheritance and `lineHeight` is an absolute
  number, so the ratio is the useless form there.

## Adding a token

Add it to the relevant module in `src/`, run the generator, commit both. The key
is the Tailwind name: colour `primary` becomes `--color-primary` and the
utilities `bg-primary`, `text-primary`, ...; radius `lg` becomes `--radius-lg`
and `rounded-lg`.

## Utilities with no token here

Three radius utilities `apps/web` uses do not resolve through the `--radius-*`
namespace, so extracting them would have meant changing markup — which BL-0053
must not do:

- `rounded-full` is a static utility (`calc(infinity * 1px)`), not a scale value.
- bare `rounded` and `rounded-t` resolve to Tailwind's deprecated `--radius`
  (`0.25rem`, the same value as `sm`).

Likewise `leading-none` is a static utility (`line-height: 1`) with no theme
variable, and letter-spacing (`tracking-*`) is out of BL-0053's scope.
