# `testID` conventions (native client)

Status: in force. Established by
[BL-0056](backlog/BL-0056-expo-app-foundation.md) **before** any real screen was
built, and enforced by `apps/mobile/src/testing/testIDs.ts`.

## Why this exists at all

React Native has no DOM and no ARIA roles. The locators the Playwright suite
leans on —

```ts
page.getByRole("listitem").filter({ hasText: "Whole milk" })
```

— have no native equivalent. Maestro selects by `id:` and React Native Testing
Library by `getByTestId`, and both read the same thing: the `testID` prop.

So `testID` is not a debugging aid on this client. It is **the selector
contract**, and the only one. That makes it API: a rename breaks tests the same
way a renamed exported function does.

Establishing the scheme up front is not tidiness. Retrofitting one across
finished screens means touching every screen and every flow that references it,
and until it is done an ad-hoc `testID` is indistinguishable from a stable one.
The cheap moment is before the screens exist, which is now.

## The shape

```
surface.element            list.generate-button
surface.element.key        list.item.whole-milk
```

Build them with the helper, never by hand:

```ts
import { surfaceTestIDs } from "@/testing/testIDs";

const id = surfaceTestIDs("list");

<Pressable testID={id("generate-button")} />
<View testID={id("item", testIDKey(line.name))} />
```

`testID()` throws on a malformed segment, so a bad id fails in the component
test that renders it rather than in a Maestro flow three weeks later.

### `surface`

A closed set, mirroring the routes: `home`, `plan`, `recipes`, `list`,
`pantry`, `history`, `settings`, plus `nav`, `auth` and `app` for what sits
outside a single route.

Closed on purpose — the point of the namespace is that `grep -r "list\." e2e/`
finds every selector on the grocery screen.

### `element`

Lowercase, digits, single inner hyphens. Name what the element **is**, not what
it looks like or what it currently says:

| Good | Bad | Why |
| --- | --- | --- |
| `generate-button` | `green-button` | Styling changes; role doesn't. |
| `empty-state` | `no-items-yet` | That's the copy, and copy changes. |
| `aisle-header` | `bold-text` | Describes the render, not the thing. |

### `key`

Only for rows in a repeated list, and **derived from the data** — a slug of the
name, an id. Use `testIDKey()` to slug user-entered text.

Never key on the array index. `list.item.3` silently points at a different row
the moment the list reorders, and the test keeps passing while asserting on
something else. `testID()` rejects a wholly numeric segment for this reason;
dates and quantities (`2026-08-16`, `1-percent-milk`) are legitimate identities
and are allowed.

## Test-only affordances

Bluesky's flows tap buttons that exist only for tests — `e2eSignInAlice`,
`e2eRefreshHome` — to skip expensive setup. That is a good pattern and we will
want it (BL-0072), but it is a *shortcut through* real behaviour, so the flow
that exercises the real path must exist first. Prefix any such affordance `e2e-`
so it is greppable and obviously not product surface.

## Relationship to the web suite

[BL-0071](backlog/BL-0071-portable-test-selectors.md) emits portable selectors
from the shared web primitives. These strings are deliberately platform-neutral
— nothing about the format is React Native specific — so the same value can be a
web `data-testid` and a native `testID`, and a journey named the same on both
clients can be compared.

## See also

- [`docs/mobile-testing-strategy.md`](mobile-testing-strategy.md) — the layer
  model, and why e2e is nightly rather than a merge gate.
- `apps/mobile/src/testing/testIDs.ts` — the implementation and its tests.
