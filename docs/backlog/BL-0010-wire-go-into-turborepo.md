---
id: BL-0010
title: Wire the Go recipe-service into the Turborepo task graph
status: proposed
area: infra
effort: S
related_specs: [2026-06-29-recipe-to-grocery-list-design.md]
created: 2026-06-29
---

## Context

Surfaced in the Plan 1 final review. The Go `recipe-service` is not part of the
Turborepo pipeline — there is no `apps/recipe-service/package.json`, so
`turbo run test`/`build` only cover `@pantry/types`. `pnpm test` therefore does
NOT run the Go suite, which is easy to mistake for full coverage.

## Proposal

Add a thin `apps/recipe-service/package.json` whose `build`/`test`/`lint`
scripts shell out to `go build ./...`, `go test ./...`, `go vet ./...`, so the
Go service participates in `turbo run build|test`. Keep Go as the source of
truth; the package.json is just a task adapter (Turbo orchestrates JS tasks and
wraps the Go commands, as the spec notes).

## Alternatives considered

- Keep Go builds/tests entirely separate (invoke `go` directly in CI) — works,
  but splits the "one command runs everything" story the monorepo is meant to
  provide.
