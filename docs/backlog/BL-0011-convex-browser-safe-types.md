---
id: BL-0011
title: Browser-safe @pantry/convex type entry (remove node-types leak)
status: proposed
area: infra
effort: M
related_specs: [2026-06-29-web-app.md]
created: 2026-06-29
---

## Context

Surfaced in Plan 2b Task 2 review. The web app imports the generated Convex api
(`@pantry/convex/api`). Under `moduleResolution: bundler`, the api type chain
resolves through Convex **source** modules (`recipes.ts`), which use
`process.env`. To make the browser app type-check, `apps/web/tsconfig.app.json`
adds `"node"` to `types`. Footgun: app code can now reference Node globals
(`process`, `Buffer`, `__dirname`) that don't exist in the browser, and
TypeScript won't complain — a runtime `undefined` waiting to happen.

A `paths` alias points `@pantry/convex/api` at the generated `api.d.ts`; the
package's `exports` also carry a `types` condition. Both were kept (the alias is
the spec-blessed fallback) but neither isolates the browser app from action
source.

## Proposal

Give `@pantry/convex` a browser-safe declaration entry that exposes the api
types WITHOUT transitively pulling in Convex action source (which needs Node):

- Option A: a proper package build (`tsc -b` emitting `dist/` with `.js` + `.d.ts`),
  and consume `@pantry/convex/api` from `dist/` where no source `.ts` shadows the
  declarations. Wire it into the Turborepo graph (see BL-0010).
- Option B: a hand-authored/narrowed `.d.ts` entry that re-exports only the
  `api` shape (`FunctionReference`s), independent of action implementations.

Then remove `"node"` from the web app's `types`.

## Alternatives considered

- Keep the `node`-types fallback — acceptable for the skeleton (it builds and is
  fully typed), but it's a real footgun as the app grows. This item removes it.
- Move the `convex/` functions into `apps/web` (the common Convex layout) so
  there's no cross-package import — rejected: we deliberately keep Convex as its
  own package (user-centric core, consumable by other services later).
