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
- **Claim before you build.** When you pick up an item, first set
  `status: in-progress` in its frontmatter — nothing else — in a **dedicated
  changeset that lands before any implementation** (e.g.
  `chore(backlog): claim BL-NNNN`). This is how parallel agents avoid grabbing
  the same item; check the item isn't already `in-progress` before claiming.
  See [`../../CLAUDE.md`](../../CLAUDE.md) for the full rule.
- On completion, set `status: done` and link the spec it produces back into
  `related_specs`.
- **The index below is generated — don't hand-edit it.** It is derived from the
  frontmatter of every item file by `scripts/backlog-index.mjs`; run
  `pnpm backlog:index` after changing an item (CI runs
  `pnpm backlog:index:check` and fails if it is stale). A hand-maintained table
  meant every parallel agent edited the same lines of this one file, so every
  merge re-conflicted every open PR.

## Index

| ID | Title | Status | Area | Effort |
|---|---|---|---|---|
| [BL-0001](BL-0001-url-import-recipe-parser.md) | URL import + recipe parser service | done | recipes | L |
| [BL-0002](BL-0002-seeded-recipe-catalog.md) | Seeded recipe catalog | in-progress | recipes | M |
| [BL-0003](BL-0003-ingredient-normalization.md) | Ingredient normalization + unit conversion + aisle grouping | done | grocery-list | L |
| [BL-0004](BL-0004-real-auth-convex-auth.md) | Real authentication (Convex Auth) | done | auth | M |
| [BL-0005](BL-0005-recommendations-service.md) | Recommendations / preference-lookup service | in-progress | recommendations | L |
| [BL-0006](BL-0006-railway-deploy.md) | Railway deployment | proposed | infra | M |
| [BL-0007](BL-0007-openapi-contract-codegen.md) | OpenAPI contract codegen | proposed | infra | M |
| [BL-0008](BL-0008-self-hosted-convex-prod-hardening.md) | Self-hosted Convex prod hardening | done | infra | M |
| [BL-0009](BL-0009-recipe-service-http-hardening.md) | recipe-service HTTP hardening (timeouts, body cap, graceful shutdown) | done | infra | S |
| [BL-0010](BL-0010-wire-go-into-turborepo.md) | Wire the Go recipe-service into the Turborepo task graph | done | infra | S |
| [BL-0011](BL-0011-convex-browser-safe-types.md) | Browser-safe @pantry/convex type entry (remove node-types leak) | done | infra | M |
| [BL-0012](BL-0012-web-ui-interaction-polish.md) | Web UI interaction polish (optimistic updates + error surfacing) | done | web | M |
| [BL-0013](BL-0013-recipe-management.md) | Recipe management — de-dup + delete | done | recipes | M |
| [BL-0014](BL-0014-e2e-browser-tests.md) | End-to-end browser tests (Playwright) | done | infra | M |
| [BL-0015](BL-0015-cross-store-delete-consistency.md) | Cross-store delete/basket partial-failure consistency | done | web | S |
| [BL-0016](BL-0016-app-ia-responsive-nav.md) | App IA + responsive navigation shell (5 routes, sidebar ↔ bottom tabs) | done | web | M |
| [BL-0017](BL-0017-home-dashboard-weekly-handoff.md) | Home dashboard — state-aware "what do I do now?" + shopping-day handoff | done | web | M |
| [BL-0018](BL-0018-meal-planner-week.md) | Meal planner — basket becomes a dinner-first week plan | in-progress | meal-planning | L |
| [BL-0019](BL-0019-grocery-list-ux-polish.md) | Grocery list UX — aisle sections, tap-to-check, recipe provenance, done-shopping | in-progress | grocery-list | L |
| [BL-0020](BL-0020-recipe-add-funnel-catalog-discovery.md) | Recipe "Add" funnel (one review screen) + catalog search & filters | in-progress | recipes | M |
| [BL-0021](BL-0021-pantry-thin-loop.md) | Pantry thin loop — auto-add from check-off, don't-rebuy, cook-decrement | done | pantry | L |
| [BL-0022](BL-0022-persist-recipe-steps.md) | Persist recipe steps | done | recipes | M |
| [BL-0023](BL-0023-grocery-pricing-cost-estimation.md) | Grocery pricing — cost estimation, then sale-aware meal recommendations | done | pricing | L |
| [BL-0024](BL-0024-headless-core-package.md) | Extract headless packages/core (planner, grocery list, import review) | done | infra | M |
| [BL-0025](BL-0025-design-tokens-as-data.md) | Design tokens as data (single source for CSS and future native styling) | done | web | S |
| [BL-0026](BL-0026-platform-portable-ui-primitives.md) | Platform-portable UI primitives (confirm dialog, auth submission) | done | web | S |
| [BL-0027](BL-0027-observability-telemetry.md) | Observability & telemetry (OpenTelemetry + Grafana LGTM) | done | infra | L |
| [BL-0028](BL-0028-pantry-cook-decrement.md) | Pantry cook-decrement — step ingredients have→low→out when a recipe is marked cooked | done | pantry | M |
| [BL-0029](BL-0029-pantry-shelf-life-expiry-nudges.md) | Pantry shelf-life & expiry nudges — category-default dates + "use this week" batches | done | pantry | L |
| [BL-0035](BL-0035-recipe-yield-servings.md) | Recipe yield — servings on the recipe model + import extraction | done | recipes | S |
| [BL-0036](BL-0036-nutrition-core-estimation.md) | Nutrition core — USDA FDC provider, gram resolution, per-recipe estimation | done | nutrition | L |
| [BL-0037](BL-0037-nutrition-plan-rollup.md) | Nutrition plan rollup — day and week totals on the planner | done | nutrition | M |
| [BL-0038](BL-0038-nutrition-targets-goals.md) | Nutrition targets — declarative goals, evaluation, and diet presets | proposed | nutrition | M |
| [BL-0039](BL-0039-nutrition-habit-review.md) | Nutrition habit review — eating history and retrospective | proposed | nutrition | M |
| [BL-0040](BL-0040-nutrition-aware-recommendations.md) | Nutrition-aware recommendations — targets as a scoring dimension | proposed | recommendations | M |
| [BL-0041](BL-0041-equipment-catalog-recipe-tagging.md) | Equipment catalog + recipe equipment/method tagging (with import detection) | done | recipes | M |
| [BL-0042](BL-0042-prep-rule-engine.md) | Prep rule engine — derived lead-time tasks (thaw, soften, preheat) on Home | proposed | recipes | L |
| [BL-0043](BL-0043-equipment-inventory-discovery.md) | Equipment inventory — "can I make this?" + new-device recipe discovery | proposed | recipes | M |
| [BL-0044](BL-0044-prep-sources-llm-manual.md) | Prep task sources — LLM-derived and hand-authored, merged with rule output | proposed | recipes | M |
| [BL-0045](BL-0045-generated-backlog-index.md) | Generate the backlog index from item frontmatter (kill the merge-conflict hotspot) | done | infra | S |
| [BL-0046](BL-0046-kroger-real-store-prices.md) | Real store prices (opt-in) — Kroger Products API behind a feature flag | proposed | pricing | M |
| [BL-0047](BL-0047-sale-aware-recommendations.md) | Sale-aware recommendations — plan the week around what's cheap right now | proposed | recommendations | L |
| [BL-0048](BL-0048-convex-admin-key-rotation.md) | Convex admin-key rotation procedure (verified, not assumed) | done | infra | S |
