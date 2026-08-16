---
id: BL-0054
title: Portable test selectors — a testID contract for shared UI
status: proposed
area: infra
effort: M
related_specs: []
created: 2026-08-16
---

## Context

`apps/web/e2e/helpers.ts` opens with a deliberate stance:

```ts
// selectors target visible text / roles / aria-labels (the app has almost no
// test ids by design).
```

That was a good call for a web-only app. Role- and text-based locators assert
accessibility as a side effect, and they fail loudly when the UI stops being
reachable the way a user reaches it.

**React Native has neither.** There is no DOM, no ARIA roles, and no accessible
name computation in the sense Playwright means. The mobile testing research
(`docs/mobile-testing-strategy.md`) found Bluesky's Maestro flows select by
`id:` almost exclusively — `composeFAB`, `composerPublishBtn`,
`selectedPhotosView` — and use text only where nothing else will do, since they
localise through Lingui and text selectors would break on every translation.

So the current stance does not port. Every locator in our eight specs would be
rewritten from scratch against a mobile client, and the two suites would drift
immediately, because nothing structural ties them together.

We have also already been bitten on the web side: the auto-loading suggestions
card on `/pantry` broke every `listitem` locator in that spec, because the
locator described the DOM's shape rather than the thing being pointed at.

The window to fix this is before mobile screens are built. Retrofitting
selectors across a finished app is the expensive version.

## Proposal

- Write down the convention: a stable, semantic id per meaningful interactive
  element and per assertable region, named for the thing, not the layout
  (`plan-add-recipe`, not `sidebar-button-3`). Emitted as `data-testid` on web
  and `testID` on React Native.
- Put the ids on the **shared primitives** (BL-0026) and the shared surfaces, so
  both clients inherit the same names from one place rather than agreeing by
  convention twice.
- Treat the id set as an interface: renaming one is a breaking change to the
  suites, and it belongs in review.
- Migrate web specs opportunistically, not wholesale. Keep role/text locators
  where they are working and carrying accessibility signal; adopt ids for the
  things that have already proven fragile, and for anything a mobile flow will
  also need to reach. A spec that asserts a heading by its text is fine; a spec
  reaching a button through three layers of DOM structure is not.
- Add the handful of pure test affordances Bluesky found worth having —
  `e2eSignInAlice`-style shortcuts past expensive setup — only once a mobile flow
  is slow enough to need them. Not up front.

## Alternatives considered

- **Keep web on roles/text and let mobile invent its own ids.** No migration
  cost, and preserves the accessibility signal in the web suite. But the two
  suites then share nothing, and the same journey gets described twice in two
  vocabularies that drift apart silently.
- **Accessibility labels as the cross-platform selector.** React Native does have
  `accessibilityLabel`, so in principle one label could serve both. In practice
  labels are user-facing copy: they change for wording reasons, they are
  translated, and overloading them as selectors means test breakage and copy
  edits become the same event.
- **Do nothing until the mobile client exists.** Defensible if mobile turns out
  to be a Capacitor/PWA wrapper, in which case Playwright covers it and this item
  should be dropped. Worth confirming that before starting.
