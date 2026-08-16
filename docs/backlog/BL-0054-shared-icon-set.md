---
id: BL-0054
title: Replace emoji icons with a shared icon set
status: in-progress
area: web
effort: S
related_specs: [2026-08-16-mobile-client-parity-design.md, 2026-07-18-mobile-client-design.md]
created: 2026-08-16
---

## Context

`apps/web/src/components/Nav.tsx` renders navigation icons as emoji literals
(`🏠`, `🗓️`, `📖`, `🛒`, `🥫`, `📈`, `⚙️`). Rule 7 of
`2026-07-18-mobile-client-design.md` called for replacing them; it is the only
rule from that document still unaddressed.

Emoji render differently across platforms and font stacks — noticeably so
between iOS, Android, and desktop browsers. A tab bar is the most visible
surface in the app, and it is the first thing a native client reproduces.

## Proposal

Adopt an icon set with matching web and React Native bindings (lucide ships
`lucide-react` and `lucide-react-native` with identical names, so a shared
`NAV_ITEMS` can name an icon once and each platform binds it).

Replace the emoji in `Nav.tsx`, keeping `NAV_ITEMS` as the single list both
platforms read. Icon choice stays presentational and per-platform; the *name*
is shared.

Web-side this is a straight visual improvement independent of any mobile work.

## Alternatives considered

- **Inline SVG components hand-authored per icon.** No dependency, full control,
  but a second platform means authoring each one twice in a different primitive
  — precisely the duplication a shared set avoids.
- **Keep emoji.** Free, and honestly fine on the web today. Rejected because the
  cross-platform inconsistency is exactly what makes it a mobile problem.
