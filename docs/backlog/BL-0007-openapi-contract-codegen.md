---
id: BL-0007
title: OpenAPI contract codegen
status: proposed
area: infra
effort: M
related_specs: [2026-06-29-recipe-to-grocery-list-design.md]
created: 2026-06-29
---

## Context

The recipe-service HTTP contract is hand-written twice in Milestone 1:
TypeScript types in `packages/types` and mirrored Go structs. This guarantees
drift — they will silently diverge and surface as a serialization mismatch at a
bad time.

## Proposal

Establish a single source of truth for the contract before it grows complex:
write an OpenAPI spec and generate the TypeScript client/types and Go
server types from it. Wire generation into the Turborepo task graph so it stays
current.

## Alternatives considered

- Define in Go and generate TS (or vice versa) — viable; OpenAPI is more neutral
  across the TS/Go split. Decide when picked up.
- Keep hand-writing — only acceptable while the contract is tiny (M1).
