---
id: BL-0001
title: URL import + recipe parser service
status: done
area: recipes
effort: L
related_specs: [2026-06-29-recipe-to-grocery-list-design.md, 2026-07-12-url-import-recipe-parser-design.md]
created: 2026-06-29
---

## Context

The recipe-source decision chose manual entry for Milestone 1, with URL import
as the immediate fast-follow. Recipe sites expose messy HTML and (sometimes)
schema.org JSON-LD, and ingredient lines like "2 cloves garlic, minced" must be
parsed into `{ quantity, unit, item, note }`.

## Proposal

Add a stateless parser/import service (strong fit for Go, or TS calling an LLM):
URL → structured recipe (ingredients + steps). It feeds the recipe-service,
which remains the canonical store. May start life *inside* recipe-service and
split out once it earns its own deployable.

## Alternatives considered

- Parse on the client — pushes a hard problem into the browser; rejected.
- Free-text ingredients with parse-on-the-fly at entry — deferred; we chose
  structured fields first so the data model is right.
