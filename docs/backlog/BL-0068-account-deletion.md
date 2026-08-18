---
id: BL-0068
title: In-app account deletion (cascade across Convex and recipe-service)
status: done
area: auth
effort: M
related_specs: [2026-08-16-mobile-client-parity-design.md]
created: 2026-08-16
---

## Context

There is **no account deletion anywhere in the codebase** — no Convex mutation,
no web UI. Users can create an account and cannot remove it or their data.

Apple App Store guideline 5.1.1(v) requires in-app account deletion for any app
that supports account creation. It is therefore a hard blocker on public iOS
launch (BL-0069), and it is independently the correct thing to have regardless
of whether a mobile client ever ships.

This is not a checkbox. User data is spread across roughly ten Convex tables
(profile, preferences, basket, grocery list, pantry items, equipment, nutrition
targets, nutrition log, prep tasks, auth accounts) and user-owned recipes live
in Postgres behind recipe-service.

## Proposal

Add account deletion, exposed on both clients:

- A Convex mutation that cascades across every user-scoped table.
- A recipe-service call to delete the user's recipes, taking care **not** to
  touch catalog rows — those are owned by the `catalog` sentinel user, not by
  the deleting user.
- Auth account and session teardown.
- An explicit, typed confirmation in the UI. Deletion is irreversible and must
  not be a one-tap action.

The cascade must be enumerated deliberately rather than inferred, and a test
should assert that no user-scoped table retains rows afterwards — a table added
later and forgotten here is a silent data-retention bug.

## Alternatives considered

- **Soft delete / deactivate.** Simpler and reversible, but does not satisfy the
  guideline, which requires deletion of the account and its data rather than
  disabling access.
- **Email-request deletion handled manually.** Explicitly insufficient under
  5.1.1(v) for apps that allow in-app account creation.
- **Defer until public launch.** Rejected: it is a data-rights obligation that
  exists now, and discovering the cascade is subtly wrong is much worse under
  store-review time pressure.
