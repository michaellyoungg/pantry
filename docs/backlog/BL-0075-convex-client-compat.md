---
id: BL-0075
title: Bound client and function skew with a compatibility gate and return validators
status: proposed
area: infra
effort: M
related_specs: []
created: 2026-11-05
---

## Context

The web bundle and the Convex functions deploy separately, and even when they
are promoted together a tab opened before the deploy keeps its old bundle and
is reconnected to the new functions. A removed function or a new required
argument fails those calls outright. A changed return shape fails silently: the
old component reads `undefined` and renders an empty list or `NaN`, with
nothing in any log.

`docs/railway-deploy.md` now requires a breaking change to a public function to
ship in two steps: both shapes side by side first, the old one removed in a
later deploy "once open tabs have turned over". Nothing tells anyone when that
has happened, so step 2 is a guess.

Mobile makes the guess much worse. `apps/mobile` reaches every Convex function
through `@pantry/core`, has no `expo-updates`, and so runs whatever build is
installed until the store updates it. Once BL-0060 and BL-0069 put builds on
real devices, an old shape has to survive for weeks, and there is no way to tell
a stale build it must update.

The functions also give the silent case no help. Of the 74 public functions,
none declares a `returns` validator, so a response shape can change without
the diff or the runtime saying so.

## Proposal

**1. A client compatibility gate.**

- `@pantry/core` exports an integer `CLIENT_API_LEVEL`, shared by web and
  mobile. It is bumped by hand in the change where a client starts depending on
  a new function shape. An integer rather than a commit SHA, because the gate
  needs ordering.
- A public query, `meta.clientCompat`, returns the minimum level the functions
  still serve, read from a Convex deployment env var
  (`MIN_CLIENT_API_LEVEL`, set with `convex env set`). This query is the one
  function whose shape never changes.
- A client below the minimum stops issuing calls and says so. Web shows a
  reload banner, keeping unsent input rather than reloading underneath it.
  Mobile shows an update-required screen linking the store.
- Step 2 of the runbook rule becomes concrete: raise `MIN_CLIENT_API_LEVEL`,
  then remove the old shape. Add that to `docs/railway-deploy.md`.

Land this before BL-0069. Every mobile build shipped without the gate is a
client that can never be told to update.

**2. `returns` validators on every public function.**

- Start with the functions the clients call most, then cover the rest. Build
  document validators from the schema rather than restating fields, so
  `_id` and `_creationTime` are not hand-copied.
- A return that does not match its validator throws on the server. That turns
  the silent `undefined` into an error that shows up in the integration and e2e
  suites before it reaches a deploy.
- Add a check, a test or a lint rule, that fails when a public function has no
  `returns`, so coverage does not decay.

## Alternatives considered

- **Versioned function names or `v1`/`v2` namespaces.** Convex does not route
  by version, so each version is a duplicate function kept in sync by hand.
  With only first-party clients, the two-step rule gets the same safety, and
  the gate supplies the one thing it lacks: knowing when old clients are gone.
- **Force a reload on every deploy.** Loses unsent input on web for changes
  that were compatible anyway, and has no equivalent on mobile.
- **Rely on TypeScript.** The generated `api` types keep one build consistent
  with itself. Skew is between two builds, which no compile step sees.
