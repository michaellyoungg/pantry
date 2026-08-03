# @pantry/design-tokens

Pantry's design tokens as data — the single source of truth for the palette
(BL-0025).

The values used to be literals in the `@theme` block of
`apps/web/src/index.css`, which made them readable only by CSS. A second client
would have had to hand-copy them, and a copied palette drifts visibly.

## How the web app consumes them

`apps/web/src/theme.generated.css` is generated from this package and imported
by `apps/web/src/index.css`. It is checked in, so `vite dev` and `vite build`
need no codegen step.

```bash
pnpm --filter @pantry/web tokens:css   # regenerate after changing a token
```

`pnpm --filter @pantry/web test` runs the generator in `--check` mode, so a
token edit that skips regeneration fails CI instead of shipping a stale
stylesheet.

## How a native client would consume them

Import the data directly — no CSS involved:

```ts
import { colorTokens } from "@pantry/design-tokens";

// NativeWind theme config
const colors = { ...colorTokens };
```

See `docs/superpowers/specs/2026-07-18-mobile-client-design.md`.

## Adding a token

Add it to `colorTokens` in `src/colors.ts`, run the generator, commit both. The
key is the Tailwind colour name: `primary` becomes `--color-primary` and the
utilities `bg-primary`, `text-primary`, ...
