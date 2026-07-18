---
id: BL-0025
title: Design tokens as data (single source for CSS and future native styling)
status: proposed
area: web
effort: S
related_specs: [2026-07-18-mobile-client-design.md]
created: 2026-07-18
---

## Context

Design tokens live in an `@theme` block in `apps/web/src/index.css`
(`--color-bg`, `--color-surface`, `--color-border`, `--color-primary`,
`--color-danger`, `--color-text`, `--color-muted`). That is fine for a single
Tailwind web app, but it means the tokens are only readable by CSS.

A second client (`2026-07-18-mobile-client-design.md`) needs the same palette,
and hand-copying it guarantees drift — the same class of problem BL-0007
addresses for the API contract.

## Proposal

Move the token values into a TypeScript module that is the single source of
truth, and generate the CSS variables from it. The web app keeps consuming
Tailwind exactly as it does today; the tokens simply stop being CSS-native.

A future NativeWind configuration then consumes the same module.

Scope is small and self-contained — no visual change should result.

## Alternatives considered

- **Leave tokens in CSS and duplicate for native.** Cheap now, guarantees drift
  later, and drift in a palette is highly visible.
- **Defer until a native client actually exists.** Reasonable, but the change is
  small and mechanical today, and it grows with every token added.
