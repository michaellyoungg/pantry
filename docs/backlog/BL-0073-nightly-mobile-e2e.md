---
id: BL-0073
title: Nightly mobile e2e — flow parity with the browser suite
status: proposed
area: mobile
effort: L
related_specs: []
created: 2026-08-16
---

## Context

Follows BL-0072, which lands the Maestro harness and one flow. This is the part
that makes it coverage rather than a demo.

The research (`docs/mobile-testing-strategy.md`) found the scheduling answer is
not the obvious one. Bluesky runs mobile e2e **nightly, not per PR**:
`nightly-e2e.yml` uses a 120-minute timeout on `macos-26-xlarge`, booting an iOS
simulator and an Android emulator and doing a full local EAS build for each. That
is far too slow and too expensive to gate a merge on. Their PR job runs lint,
Jest, and per-platform typechecking instead.

We should plan for the same economics from the start, rather than discovering
them by making every PR wait forty minutes. Our CI is also already sensitive to
cost — jobs have been blocked at the account level before.

The second half is parity. Our eight Playwright specs describe journeys —
core loop, catalog, home dashboard, recommendations, prep tasks, nutrition facts,
suggest-week, aggregation and isolation. Those journeys are the same on mobile.
If the flow set is written independently it will cover a different, accidental
subset, and no one will be able to tell which client is under-tested.

## Proposal

- Grow `apps/mobile/e2e/flows/` to cover the journeys the Playwright specs cover.
  **Name each flow after its web spec** so a missing file is visible parity drift
  rather than an unknown gap.
- Add a nightly workflow (schedule + `workflow_dispatch`), iOS and Android as
  separate jobs, with a generous timeout, artifacts uploaded on failure —
  recordings, device logs, build logs. A nightly failure nobody can debug from
  the artifacts is a nightly failure nobody will fix.
- Keep it off the PR path. Per-PR mobile stays lint + typecheck + jest-expo
  (the harness BL-0056 sets up), matching the browser suite's split between
  fast checks and the full loop.
- Decide and document the triage rule up front: who looks at a red nightly, and
  what happens if it stays red. A nightly suite with no owner decays into noise
  within a month, and then gets deleted.
- Consider per-platform tsconfigs (`tsconfig.check.ios.json` / `.android` /
  `.web`, as Bluesky has) **only once platform-conditional files exist**. Cheap
  and worth it then; pure ceremony before.

## Alternatives considered

- **Run mobile e2e per PR.** Best feedback latency, and what we do for the
  browser suite. Rejected on cost and wall clock: simulator boot plus a native
  build dwarfs the compose stack, and it would make every PR — including
  docs-only ones — pay for it.
- **iOS only.** Halves the cost and most bugs reproduce on both. But the platform
  divergences that do exist (keyboard handling, back navigation, permissions) are
  exactly what a native suite is for, and Android is where they live.
- **A hosted device cloud instead of CI runners.** Removes simulator maintenance
  and adds real-device coverage. Worth revisiting if runner upkeep becomes the
  bottleneck; not worth the spend before the flow set has proven its value.
- **Fewer, longer flows.** Cheaper per run, since setup dominates. But a failure
  in a 200-step flow tells you almost nothing about where it broke, and Bluesky's
  17 flows are scoped per journey for that reason.
