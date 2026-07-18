# Home dashboard — state-aware next action + shopping-day handoff (BL-0017)

**Status:** approved · **Backlog item:** [BL-0017](../../backlog/BL-0017-home-dashboard-weekly-handoff.md)
· **Related:** [full-app UX plan](2026-07-12-full-app-ux-plan.md)

## Goal

Home (`/`) answers one question — *what do I do now?* — and carries the plan → shop
handoff. It is read-and-route: it never asks for detailed work. Today `Home.tsx` is a
static four-card link grid that knows nothing about the user's state.

## Constraints

- **No schema or backend changes.** Everything derives from two existing queries:
  `api.basket.list` (the week plan; rows carry `weekday`, `slot`, `servingsMultiplier`,
  `type`, and a denormalized `title`) and `api.groceryList.getGroceryList`.
- There is no `lastGeneratedAt` and no recipe provenance on grocery lines, so
  **"list built" means "the grocery list is non-empty"** and shopping progress is the
  checked count.
- Recipes live in the Go recipe-service behind a Convex **action**, not a query. Home
  must not call it — an action per mount is too expensive for what it would buy.
- BL-0018/0019/0020 are reshaping the planner and list concurrently. Home reads only
  through existing exported queries and keeps its logic in a pure function, so a schema
  shift is a one-file fix.

## Derived state

A pure `deriveHomeState(basket, list)` in `apps/web/src/lib/homeState.ts`, evaluated in
this order:

| State | Condition | Primary CTA |
|---|---|---|
| `loading` | either query is `undefined` | skeleton |
| `shopping` | list non-empty, some unchecked | "Shopping day — N items ready" → `/list` |
| `shopped` | list non-empty, all checked | "All N items checked — plan next week" → `/plan` |
| `planned` | list empty, basket non-empty | "Build grocery list (N meals)" → generate, then `/list` |
| `empty` | both empty | "Plan this week" → `/plan` |

List state is checked before basket state, so clearing the plan mid-shop does not yank
the handoff card away.

`shopped` is not in the backlog text, but the state is reachable and needs an answer;
routing back to planning closes the weekly loop.

`planned` counts **meals**, not grocery items: the item count is unknown until the list
is generated, and `basket` rows with `type: "leftover"` are excluded because
`generateGroceryList` already filters them out.

## Components

`Home.tsx` becomes a thin orchestrator over four focused components, each testable on
its own:

- **`WeekStrip`** — 7 cells, Mon–Sun (the schema's `weekday` is `0`=Mon). Each cell lists
  that day's planned titles; `type: "leftover"` rows are marked as leftovers; empty cells
  show "+ add". Every cell links to `/plan`.

  Cells deliberately do **not** deep-link to a focused day. `/plan` has no day parameter
  today, and adding one means changing the planner's route contract while BL-0018 is in
  flight. It is a cheap follow-up once that lands.

- **`NextAction`** — the state-aware CTA card, and in `shopping` the shopping-day handoff
  (item count and checked progress) rendered prominently. In `planned` it calls
  `api.recipes.generateGroceryList` in place using the `useAsyncAction` + `<ErrorText>`
  pattern established in `WeekPlan.tsx`, then navigates to `/list`. Generating from Home
  removes a hop from the most common weekly action.

- **`QuickActions`** — Import recipe · Browse catalog · Open list.

- **`GettingStarted`** — ① Add meals to your week ② Build your list ③ Shop. Driven by the
  same two queries; disappears once step ③ starts.

## Testing

- Exhaustive unit tests on `deriveHomeState`: all five states, plus the plan-cleared-
  mid-shop edge and the leftover-exclusion count.
- Component tests follow the two existing conventions — `vi.mock("convex/react")` with
  hoisted mutable state for query-driven rendering, and an in-memory router for link
  assertions. Error rendering is asserted via a rejecting action mock and `role="alert"`,
  as in `GroceryList.test.tsx`.
- No nav destination is added, so `Nav.test.tsx`'s `NAV_ITEMS` length assertion is
  untouched.

## Alternatives considered

- **CTA routes to `/plan` instead of generating in place.** Avoids duplicating the action
  call, but adds a hop to the weekly loop's most common action. Rejected.
- **Persist a `listGeneratedAt` / shopping-session field.** Would make "list built" and
  "done shopping" explicit rather than derived, but it is a schema change on a table two
  in-flight items are already touching. Deferred until BL-0019's "done shopping" flow
  defines what a shopping session actually is.
- **Checklist verifies "you have recipes."** Requires the recipe-service action on every
  Home mount. Rejected on cost.
