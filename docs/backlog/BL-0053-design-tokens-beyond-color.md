---
id: BL-0053
title: Design tokens beyond color (spacing, radii, typography)
status: done
area: web
effort: S
related_specs: [2026-08-16-mobile-client-parity-design.md]
created: 2026-08-16
---

## Context

BL-0025 moved the colour palette out of CSS and into `@pantry/design-tokens`,
which now exports `colorTokens` and renders the `@theme` CSS block from it. That
solved drift for colour.

Everything else in the design system is still Tailwind defaults referenced by
utility class: spacing, border radii, font sizes, weights, and line heights. A
native client cannot read a Tailwind default — NativeWind needs the scale as
data, exactly as it needs the palette.

Doing this before `apps/mobile` exists (BL-0056) keeps the two view layers
visually identical by construction rather than by inspection.

## Proposal

Extend `@pantry/design-tokens` with the non-colour scales the web app actually
uses, and generate the Tailwind theme from them the same way the palette is
generated today. Keep the existing `--check` drift guard covering the new
output.

Scope is deliberately narrow: only tokens `apps/web` already relies on. This is
not an invitation to design a new system.

No visual change should result — if one does, the extraction was wrong.

## Alternatives considered

- **Leave the rest as Tailwind defaults and hand-map them in NativeWind.**
  Cheap now, guarantees drift, and drift in spacing is the kind that makes two
  clients feel like two products.
- **Defer until the native client needs it.** Same argument BL-0025 rejected,
  with the same answer: the change is small and mechanical today and grows with
  every token added.
