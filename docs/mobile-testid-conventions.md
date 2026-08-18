# Test selector conventions

Status: in force. Established for the native client by
[BL-0056](backlog/BL-0056-expo-app-foundation.md) **before** any real screen was
built, and extended to the web client by
[BL-0071](backlog/BL-0071-portable-test-selectors.md). Enforced by
`packages/core/src/testing/`, which both clients read: `testID` on native,
`data-testid` on web, one builder and one set of names.

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
import { surfaceTestIDs } from "@pantry/core/testing";

const id = surfaceTestIDs("list");

// native
<Pressable testID={id("generate-button")} />
<View testID={id("item", testIDKey(line.name))} />

// web — the shared primitives take a `testId` prop and emit `data-testid`
<Button testId={TEST_IDS.list.doneShopping} />
<SwipeAwayRow testId={TEST_IDS.list.item(line.item)} />
```

The prop is typed `TestID`, not `string`, so it has to come out of `testID()`.
A hand-written `"list.item"` does not compile, which is the compile-time half
of the same rule the runtime check below enforces.

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

## The web half

The Playwright suite opened with a deliberate stance: locate by role, text and
`aria-label`, because those assert accessibility as a side effect and fail
loudly when the UI stops being reachable the way a user reaches it. That stance
still holds. BL-0071 did **not** replace it — it drew a line through it.

**An id names *which thing*; a role names *what you do to it*.**

- Identity of a repeated row — which grocery line, which pantry item, which
  recipe — is an id. This is where the role-based locators kept breaking: they
  described the DOM's shape, so a neighbouring card growing a list of its own
  turned one match into two and Playwright hard-failed on strict mode. It is
  also the part a native flow has to reach, and `listitem` does not exist there.
- The control inside that row keeps its role and its accessible name. A spec
  that ticks `row.getByRole("checkbox")` is asserting the line is operable by a
  screen reader, and no id can say that.
- Copy that *is* the assertion (a heading's text, "Uses up:") stays text.
- Copy that is merely how a control is currently worded — "Need an account?
  Sign up", "Add item" / "Close" — became an id, because a rewording should not
  break the suite.

The migration is therefore partial by design, and stays partial. Adopt an id
when a locator has proven fragile or when a native flow will reach the same
element; leave the rest.

### `TEST_IDS` — the shared names

`packages/core/src/testing/sharedTestIDs.ts` names the elements both clients
render. `testIDs.ts` fixes the format; `TEST_IDS` fixes the vocabulary, which is
the part that would otherwise be agreed twice — the web spec calling the
grocery line one thing and the Maestro flow another, with no file whose absence
says they have diverged.

`TEST_IDS.list.clearConfirm` is the worked example: the web asks "clear the
grocery list?" through the BL-0026 confirm primitive and the native client
through its own sheet, and the three ids (`list.confirm-sheet`,
`list.confirm-clear`, `list.confirm-cancel`) are what make that one flow rather
than two that resemble each other.

Native screens written before BL-0071 pass the equivalent literals to
`surfaceTestIDs("list")`; the strings are identical, and a screen moves onto
`TEST_IDS` when it is next touched.

### What keys a row

Whatever the *spec* can name in advance, slugged with `testIDKey()`:

| Surface | Key | Why not the obvious alternative |
| --- | --- | --- |
| `list.item` | the ingredient | The walk reorders as lines are ticked. |
| `pantry.item` | the canonical item | The display form is the normalization table's to change; the canonical key is what native keys on too. |
| `recipes.item` | the title | The recipe's id is server-minted, so no spec can predict it. |

The recipe case has a known limit: the app tolerates duplicate titles and even
flags them, so two rows can answer to one id. Every e2e title is minted with
`uniqueSuffix()`, so the suite never meets it, and `RecipeList.test.tsx` pins
the behaviour so it is a documented limit rather than a surprise.

## See also

- [`docs/mobile-testing-strategy.md`](mobile-testing-strategy.md) — the layer
  model, and why e2e is nightly rather than a merge gate.
- `packages/core/src/testing/` — the implementation and its tests.
- `apps/web/e2e/helpers.ts` — the mixed-selector policy applied.
