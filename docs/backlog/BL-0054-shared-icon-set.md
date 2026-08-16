---
id: BL-0054
title: Replace emoji icons with a shared icon set
status: done
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

## Outcome

`NAV_ITEMS` moved to `packages/core/src/nav.ts` and is exported from
`@pantry/core`. `icon` is a lucide export name, not a component; `to` is a
`NavRoute` union rather than `string`:

```ts
{ to: "/list", label: "List", icon: "ShoppingCart" }
```

Both clients bind the names themselves — the binding is the only per-platform
piece:

| Client | Binding | Package |
| --- | --- | --- |
| Web | `NAV_ICONS` in `apps/web/src/components/Nav.tsx` | `lucide-react` |
| Mobile | `NAV_ICONS` in `apps/mobile/src/navigation/navIcons.ts` | `lucide-react-native` |

Both are typed `Record<NavIconName, LucideIcon>`, so a destination added to the
shared list fails the build on whichever platform has not bound its icon.
`apps/mobile/src/navigation/navItems.ts` likewise derives order, labels and
icons from the shared list and keys its Expo Router route names by `NavRoute`,
replacing the hand-kept copy BL-0056 shipped.

Icons: `House`, `CalendarDays`, `BookOpen`, `ShoppingCart`, `Refrigerator`,
`ChartLine`, `Settings` — present in both packages at 1.31.0.

Notes:

- Mobile imports one subpath per icon (`lucide-react-native/icons/house`), not
  the barrel: the barrel re-exports ~1,700 icons and Metro does not tree-shake
  by default. Web imports named exports from `lucide-react`, which Vite does
  tree-shake — only the icon factory reaches the bundle.
- Icons render `aria-hidden` on web, as the emoji did, so each link's
  accessible name is still its label. No e2e spec selected on the emoji.
- `@pantry/types` is untouched and stays type-only.
