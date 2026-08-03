---
id: BL-0026
title: Platform-portable UI primitives (confirm dialog, auth submission)
status: done
area: web
effort: S
related_specs: [2026-07-18-mobile-client-design.md]
created: 2026-07-18
---

## Context

Two patterns in the web app have no React Native equivalent and would block
sharing the surrounding logic (`2026-07-18-mobile-client-design.md`):

- `window.confirm` — `apps/web/src/components/GroceryList.tsx:21` and
  `apps/web/src/components/RecipeList.tsx:44`. No RN equivalent; native uses
  `Alert`.
- `FormData`-based submission — `apps/web/src/components/AuthForm.tsx` builds a
  `FormData` and passes it to `signIn("password", ...)`. Convex Auth accepts a
  plain object just as happily, and RN has no `<form>`/`onSubmit`.

Both are also mild web-side improvements on their own: `window.confirm` blocks
the main thread and cannot be styled or tested without stubbing the global.

## Proposal

Replace `window.confirm` with a small confirm abstraction (a promise-returning
hook backed by an in-app dialog), and change `AuthForm` to pass plain values to
`signIn` rather than a `FormData`.

Neither change alters behaviour; both remove a platform assumption and make the
call sites testable without patching globals.

## Alternatives considered

- **Leave them and special-case at porting time.** Viable — these are two small
  call sites — but the confirm dialog in particular is a UX improvement on the
  web independently, so there is little reason to wait.

## Outcome

- `apps/web/src/components/ui/useConfirm.tsx` — `confirm(options) =>
  Promise<boolean>`, the portable surface both call sites now await. A native
  client keeps the call sites and backs the hook with `Alert`.
- `apps/web/src/components/ui/ConfirmDialog.tsx` — the web rendering, the part a
  native client replaces. An explicit overlay rather than
  `<dialog>.showModal()`, because jsdom does not implement `showModal` and
  being unit-testable is half the point of retiring `window.confirm`.
- `AuthForm` holds email/password as state and passes
  `{ email, password, flow }` to `signIn`; no `FormData`, no `<form>`
  dependency.

Not covered here: `RecipeEditDialog` still uses `<dialog>.showModal()`. It is a
form, not a confirmation, so it needs its own port — and, like `RecipeForm`, it
is untested for the same `showModal` reason.
