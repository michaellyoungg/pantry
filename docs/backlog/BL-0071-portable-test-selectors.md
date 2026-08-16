---
id: BL-0071
title: Emit portable test selectors from the shared web primitives
status: proposed
area: web
effort: M
related_specs: [2026-08-16-mobile-client-parity-design.md]
created: 2026-08-16
---

## Context

BL-0056 establishes `testID` conventions for the native client, before any
screen is built. This item is the **web half of the same contract** — nothing
here duplicates it.

`apps/web/e2e/helpers.ts` opens with a deliberate stance:

```ts
// selectors target visible text / roles / aria-labels (the app has almost no
// test ids by design).
```

That was a good call for a web-only app. Role- and text-based locators assert
accessibility as a side effect, and they fail loudly when the UI stops being
reachable the way a user reaches it. It is worth being explicit that this item
revisits a decision someone made on purpose, rather than filling an oversight.

The problem is that the two clients will name the same things differently.
BL-0056 gives mobile its vocabulary; the web suite keeps role/text locators; and
the same journey ends up described twice, in two schemes, with nothing
structural tying them together. Drift is then invisible — there is no file whose
absence tells you the web suite and the mobile flows have diverged.

We have also already been bitten on the web side independently of mobile: the
auto-loading suggestions card on `/pantry` broke every `listitem` locator in
that spec, because the locator described the DOM's shape rather than the thing
being pointed at.

## Proposal

- Emit the ids from the **shared primitives** (BL-0026) and shared surfaces, so
  both clients inherit the same names from one place instead of agreeing by
  convention twice: `data-testid` on web, `testID` on native, one source.
- Adopt BL-0056's naming scheme rather than inventing a second one. If this item
  lands first, hand the scheme to BL-0056; if BL-0056 lands first, follow it.
  What matters is that there is exactly one.
- Treat the id set as an interface. Renaming one is a breaking change to both
  suites and belongs in review.
- Migrate web specs **opportunistically, not wholesale**. Keep role/text
  locators where they are working and carrying accessibility signal — a spec
  asserting a heading by its text is fine and should stay. Adopt ids for what
  has already proven fragile, and for anything a mobile flow will also reach.
- Add pure test affordances (Bluesky's `e2eSignInAlice`-style shortcuts past
  expensive setup) only once a flow is slow enough to need them. Not up front.

## Alternatives considered

- **Let the web suite keep roles/text and let mobile do its own thing.** Zero
  migration cost, and preserves the accessibility signal. This is the status quo
  if nobody picks this up, and it is survivable — the cost is silent divergence
  between two descriptions of the same journeys, paid later.
- **Accessibility labels as the shared selector.** React Native has
  `accessibilityLabel`, so in principle one label serves both. In practice
  labels are user-facing copy: they get reworded and translated, so selector
  breakage and copy edits become the same event.
- **Rewrite the web suite onto ids wholesale.** Symmetric and tidy, but it
  discards the accessibility assertions that role-based locators give us for
  free, in exchange for symmetry we do not need everywhere.
