---
id: BL-0053
title: Unpin the e2e suite from a single worker (backend isolation)
status: proposed
area: infra
effort: M
related_specs: []
created: 2026-08-16
---

## Context

`apps/web/playwright.config.ts` pins the suite to one worker:

```ts
// The full loop mutates shared per-deployment state, so keep it serial.
fullyParallel: false,
workers: 1,
```

Eight specs now run end to end, each driving a full compose stack, and every one
of them waits for the last. This is the single biggest lever on e2e wall clock,
and it gets worse as specs are added.

The comment may also be out of date. `e2e/helpers.ts` already registers a brand
new account per spec (`signUp()` mints an `e2e-<timestamp>-<rand>@example.test`
user), and `uniqueSuffix()` namespaces recipe titles, so user-scoped data —
recipes, basket, plan, pantry, interaction log — is already isolated. What is
genuinely shared is narrower than "per-deployment state" suggests: the seeded
catalog (read-only, owned by the `catalog` sentinel), the Convex Auth tables, and
whatever throughput one self-hosted backend will take.

Mobile makes this pressing rather than merely annoying. The mobile testing
research (`docs/mobile-testing-strategy.md`) found that Bluesky provisions a
**fresh backend per flow** — each Maestro flow POSTs to a dev-env server, gets an
ephemeral test PDS, and points the app at it — which is what lets their flows run
without a serialisation pin. If we add a second client driving the same single
Convex deployment, contention stops being theoretical.

## Proposal

Find out what actually blocks parallelism before building anything, because the
cheap answer may already be available:

- Set `workers: 4` and run the suite repeatedly. Record what fails and why. If it
  is green, the pin is stale and the fix is deleting two lines.
- If it fails, classify: genuine cross-spec data collision, Convex Auth
  contention, self-hosted backend throughput, or port/fixture collisions in
  `scripts/e2e.sh`. Each has a different fix, and only the first justifies real
  isolation machinery.
- Fix the cheapest sufficient level. In rough order of cost: namespace the
  remaining shared writes → one Convex deployment per Playwright worker (not per
  spec) → a provisioning endpoint that hands a test a fresh backend, the Bluesky
  shape.
- Whatever lands, leave the resulting constraint written down in the config, with
  the evidence. The current comment is an assertion nobody can check.

The payoff is shared: the same isolation story is what mobile e2e (BL-0055) needs
to run flows without contending with the browser suite.

## Alternatives considered

- **Leave it serial.** Honest and free. But the suite only grows, and the pin
  becomes the reason people stop adding specs — which is the expensive failure.
- **Ephemeral Convex deployment per spec** — the closest copy of Bluesky. Cleanest
  isolation, but a self-hosted Convex deployment is far heavier to stand up than
  their in-memory test PDS, and per-*worker* likely buys most of the win for a
  fraction of the cost.
- **Sharding across CI jobs instead of workers.** Cuts wall clock without solving
  isolation, and multiplies the compose-stack cost per job. Worth doing only
  after the isolation question is answered.
