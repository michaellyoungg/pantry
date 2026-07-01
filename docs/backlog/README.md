# Pantry Backlog

Future work, captured in-repo and formatted for both humans and agents to read,
append, and iterate on. Each item is one markdown file with YAML frontmatter so
it can be filtered/sorted/updated programmatically.

## Conventions

- **One file per item:** `BL-NNNN-short-slug.md`.
- **Frontmatter fields:**
  - `id` — `BL-NNNN`, zero-padded, monotonically increasing.
  - `title` — short human title.
  - `status` — `proposed` | `accepted` | `in-progress` | `done` | `dropped`.
  - `area` — `recipes` | `grocery-list` | `pantry` | `infra` | `auth` |
    `recommendations` | ...
  - `effort` — `S` | `M` | `L`.
  - `related_specs` — list of spec filenames under
    `docs/superpowers/specs/`.
  - `created` — `YYYY-MM-DD`.
- **Body sections:** `## Context` (the decision it branched off),
  `## Proposal` (what we'd do), `## Alternatives considered`.
- When an item is picked up, set `status` and link the spec it produces back
  into `related_specs`.

## Index

| ID | Title | Status | Area | Effort |
|---|---|---|---|---|
| [BL-0001](BL-0001-url-import-recipe-parser.md) | URL import + recipe parser service | proposed | recipes | L |
| [BL-0002](BL-0002-seeded-recipe-catalog.md) | Seeded recipe catalog | proposed | recipes | M |
| [BL-0003](BL-0003-ingredient-normalization.md) | Ingredient normalization + unit conversion + aisle grouping | proposed | grocery-list | L |
| [BL-0004](BL-0004-real-auth-convex-auth.md) | Real authentication (Convex Auth) | proposed | auth | M |
| [BL-0005](BL-0005-recommendations-service.md) | Recommendations / preference-lookup service | proposed | recommendations | L |
| [BL-0006](BL-0006-railway-deploy.md) | Railway deployment | proposed | infra | M |
| [BL-0007](BL-0007-openapi-contract-codegen.md) | OpenAPI contract codegen | proposed | infra | M |
| [BL-0008](BL-0008-self-hosted-convex-prod-hardening.md) | Self-hosted Convex prod hardening | proposed | infra | M |
| [BL-0009](BL-0009-recipe-service-http-hardening.md) | recipe-service HTTP hardening (timeouts, body cap, graceful shutdown) | done | infra | S |
| [BL-0010](BL-0010-wire-go-into-turborepo.md) | Wire the Go recipe-service into the Turborepo task graph | done | infra | S |
| [BL-0011](BL-0011-convex-browser-safe-types.md) | Browser-safe @pantry/convex type entry (remove node-types leak) | done | infra | M |
| [BL-0012](BL-0012-web-ui-interaction-polish.md) | Web UI interaction polish (optimistic updates + error surfacing) | proposed | web | M |
| [BL-0013](BL-0013-recipe-management.md) | Recipe management — de-dup + delete | proposed | recipes | M |
| [BL-0014](BL-0014-e2e-browser-tests.md) | End-to-end browser tests (Playwright) | proposed | infra | M |
| [BL-0015](BL-0015-cross-store-delete-consistency.md) | Cross-store delete/basket partial-failure consistency | proposed | web | S |
