# Mobile client — feasibility, estimate, and architectural prep

**Date:** 2026-07-18
**Status:** design approved; no implementation scheduled
**Related:** [`2026-07-12-full-app-ux-plan.md`](2026-07-12-full-app-ux-plan.md)

## Summary

Adding a native mobile client to Pantry is a **~10–14 week** effort for one
developer, ending at a TestFlight-ready in-store companion app. Of that, 3–4
weeks is preparatory work that improves the web app whether or not the mobile
client is ever built.

Pantry is already unusually well positioned for this, mostly as a side effect of
decisions already made. The purpose of this document is to record *why*, to fix
the shape of the eventual client, and to name the decisions that are cheap today
and expensive later.

## Decisions

Settled during design:

| Question | Decision |
|---|---|
| What kind of client? | **Native (Expo / React Native)** sharing the Convex backend. Not a PWA, not a Capacitor shell. |
| How much code is shared? | **Headless React only.** Hooks, state, and pure functions are shared; view layers are written separately per platform. |
| Scope? | **Architect for parity, ship the in-store subset first.** The headless layer must eventually cover all five routes; the native view layer starts with grocery list and pantry. |
| Offline? | **Durable local cache for the grocery list only.** Persist the list and pending check-offs; reconcile on reconnect. Not offline-first across the app. |

## Why the current architecture helps

- **One client entry point.** The browser only ever speaks to Convex over
  WebSocket; Convex proxies to the Go recipe-service with a service secret
  (`apps/recipe-service/internal/recipe/middleware.go:24`). A native client
  plugs into the same door — no CORS, no cookie-domain problems, no second auth
  path, and no new public surface area.
- **Bearer-token auth with pluggable storage.** Convex Auth holds a JWT plus
  refresh token in a swappable `TokenStorage`. The native client substitutes
  `expo-secure-store` and gets the same session. Cookie-session auth is the most
  common thing that sinks a mobile retrofit; Pantry never adopted it.
- **The expensive logic is server-side and platform-agnostic.** Ingredient
  normalization, unit conversion, aisle mapping, aggregation, and URL import all
  live in Go behind a boundary no client can see. A second client inherits all of
  it for free.
- **The typed function API is already a package.** `@pantry/convex/api` and the
  dependency-free `@pantry/types` are both consumable from React Native as-is.

## What blocks it today

- **No shared logic layer.** Week-plan day bucketing and servings clamping are
  inline in `apps/web/src/components/WeekPlan.tsx`; aisle grouping is inline in
  `apps/web/src/components/GroceryList.tsx`. A second client would re-author all
  of it. This debt is accruing right now, while BL-0018/0019/0020 are in flight —
  which is precisely why the extraction is cheapest to do immediately.
- **No deployed backend.** BL-0006. A native app needs a reachable HTTPS/WSS
  endpoint; `docker compose` on localhost is not one. This is a hard prerequisite
  but is already on the roadmap for independent reasons, so it is not counted as
  mobile cost.
- **No Go↔TS contract codegen.** BL-0007. Go structs and `@pantry/types` are
  hand-mirrored. A second consumer multiplies the drift surface, so this should
  land *before* the native client exists rather than after.
- **Web-only primitives in shared paths.** Tailwind `className` throughout,
  `window.confirm` in `GroceryList.tsx` and `RecipeList.tsx`, and `FormData`-based
  submission in `AuthForm.tsx`.

## Estimate

One developer, focused. Ranges reflect genuine uncertainty rather than padding.

### Phase 0 — prep that pays for itself regardless (3–4 weeks)

| Work | Estimate | Notes |
|---|---|---|
| Extract headless `packages/core` | 1–1.5 wk | Planner bucketing, servings clamping, aisle grouping, import-review state. Improves web testability immediately. |
| OpenAPI contract codegen (BL-0007) | ~1 wk | Already backlogged. Do it before a second consumer exists. |
| Design tokens as data | 2–3 days | Today an `@theme` block in `apps/web/src/index.css`. Move to a TS module that emits CSS variables *and* feeds NativeWind. |
| Platform-portable primitives | 2–3 days | Replace `window.confirm` with a confirm abstraction; replace `FormData` auth submission with plain values. |

### Phase 1 — React Native foundation (2–3 weeks)

Expo scaffold, Metro resolution against pnpm workspaces (the genuinely fiddly
part), Convex client wiring, auth via `expo-secure-store`, navigation, NativeWind
bound to the shared tokens.

### Phase 2 — in-store subset (3.5–5 weeks)

Grocery list native views with aisle sections and one-handed check-off (~2 wk);
durable offline cache with pending-mutation replay (~1.5–2 wk); pantry route
(~1 wk).

### Phase 3 — ship (1–1.5 weeks, plus review latency)

EAS build, TestFlight, icons and splash, store listing, privacy disclosures.
Apple review is calendar time outside our control.

### Beyond

Expanding toward parity runs roughly 1–2 weeks per route, assuming the headless
layer holds.

**The ongoing tax matters more than the one-time cost:** once this lands, every
new feature requires two view implementations, permanently. That is the decision
being made here — not the 10–14 weeks.

## Architectural rules to adopt now

These cost close to nothing today and become expensive to retrofit.

1. **Headless-first discipline.** Domain logic belongs in `packages/core` or in
   Go — never in a component. This single rule does most of the work; the rest
   are details.
2. **Convex remains the only client entry point.** No client ever talks to the Go
   service directly. True today; worth stating as a rule so it stays true.
3. **Design tokens are data, not CSS.** One source of truth that both platforms
   consume.
4. **NativeWind over a separate styling system**, so the two view layers read
   similarly and reviewers can follow both.
5. **Navigation does not leak into shared code.** `@tanstack/react-router` stays
   in `apps/web`; shared code receives navigation via props or a thin adapter.
6. **Grocery check-off stays commutative.** It is already a boolean keyed on
   `item|unit|aisle`, which is exactly why offline is cheap here. If regeneration
   ever becomes order-dependent, the offline story gets substantially harder.
7. **Replace emoji icons with a real icon set** in `apps/web/src/components/Nav.tsx`
   — emoji render inconsistently across platforms.

## Risks

- **The offline cache is the riskiest line item.** "Persist and replay" is
  straightforward until the list is regenerated server-side while the phone is
  offline holding check-offs against the previous list. The existing
  `mergeGroceryList` diff-merge already preserves `checked` across regeneration
  (`packages/convex/convex/groceryList.ts`), which is most of the answer — but
  that path should be proven with a test before the Phase 2 estimate is trusted.
- **Metro plus pnpm workspaces** is a known source of multi-day setup problems.
  The Phase 1 range accounts for it, but it is the most likely place to overrun.
- **Headless extraction can drift back.** Without enforcement, domain logic
  re-accumulates in components. Worth a lint rule or a review convention.

## Alternatives considered

- **Responsive web / PWA.** Cheapest, and where
  `2026-07-12-full-app-ux-plan.md` currently points. Rejected because the target
  use case is in-store, where offline reliability and camera access are the
  differentiators, and where that document itself concedes (`:250`) that web is
  structurally weaker.
- **Capacitor shell around the existing web app.** Store presence for almost no
  UI work, but delivers a website in a box — the in-store experience would not
  measurably improve, which is the entire point.
- **Full code sharing via React Native Web.** Highest ceiling, but it constrains
  the web app's styling and component choices starting immediately, in exchange
  for benefits that only materialize if mobile is actually built.
- **Offline-first across the whole app.** Would require a local source of truth
  and a sync engine, fighting Convex's model rather than using it — plausibly a
  larger line item than the RN app itself. Much easier to add later for one more
  feature than to remove once load-bearing.

## Follow-on backlog

Phase 0 items are filed separately so they can be picked up independently of any
mobile commitment:

- BL-0024 — extract headless `packages/core`
- BL-0025 — design tokens as data
- BL-0026 — platform-portable UI primitives
- BL-0007 — OpenAPI contract codegen (existing)
- BL-0006 — deployment (existing, hard prerequisite)
