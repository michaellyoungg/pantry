# CI & Code Quality

This repo runs automated checks on every pull request via GitHub Actions. With
many contributors (human and agent) landing changes, these are the guardrails
that keep `main` green.

## What runs on every PR

`.github/workflows/ci.yml` has two jobs:

| Job | Steps |
| --- | --- |
| **Node** | oxlint (lint) · oxfmt (format + import order) · backlog index freshness · TypeScript typecheck · Vitest with coverage (incl. design-token drift guard) plus `jest-expo` for `apps/mobile` · build · Knip (dead code / unused deps) |
| **Go** | `gofmt` check · `go vet` · `go test -race -cover` · `golangci-lint` · `govulncheck` (advisory) |

`.github/dependabot.yml` opens weekly dependency-update PRs for npm, Go modules,
and the GitHub Actions we use. Combined with **Dependabot alerts** (enabled in
repo settings) this is the free dependency-vulnerability layer for this private
repo.

> **On CodeQL:** GitHub's CodeQL code scanning requires GitHub Advanced
> Security, which is **free only for public repos** — on a private repo it is a
> paid add-on. We therefore rely on Dependabot alerts + `govulncheck` for free
> security coverage. If the repo goes public (or GHAS is purchased), a CodeQL
> workflow can be added.

## Running the checks locally

Everything CI runs is available through pnpm from the repo root:

```bash
pnpm lint            # oxlint + oxfmt --check (TS) + go vet (via turbo)
pnpm format          # oxfmt (format + import order), then oxlint --fix
pnpm typecheck       # tsc across all packages
pnpm test            # Vitest + jest-expo (apps/mobile) + go test
pnpm test:coverage   # Vitest with coverage thresholds enforced
pnpm knip            # unused files / exports / dependencies
pnpm check           # lint + typecheck + test in one shot
pnpm backlog:index   # regenerate the docs/backlog/README.md index table
```

The backlog index table is generated from each item's frontmatter
(`scripts/backlog-index.mjs`) so parallel agents stop conflicting on one
hand-maintained table. CI runs `pnpm backlog:index:check`, which regenerates
in-memory and fails if the committed table is stale — run `pnpm backlog:index`
and commit the result.

Two heavier suites are **not** part of the per-PR gate and run on demand:

```bash
pnpm test:integration  # cross-service contract (Convex ⇄ recipe-service ⇄ Postgres)
pnpm test:e2e          # full loop in a real browser (Playwright) against a compose stack
```

`test:e2e` (see [`README.md`](../README.md#end-to-end-browser)) drives the whole
user loop against a live stack; it needs Docker, Go, and a Playwright browser
(`pnpm --filter @pantry/web exec playwright install --with-deps chromium`), so it
stays out of the fast unit gate.

Go tooling (run from `apps/recipe-service`):

```bash
gofmt -l .           # lists unformatted files (should be empty)
go vet ./...
go test -race ./...
golangci-lint run    # install: https://golangci-lint.run/welcome/install/
```

## Tooling reference

- **oxlint** (`.oxlintrc.json`) — the linter, from the same oxc toolchain Vite 8
  and Vitest 4 already build on. The `correctness` category is an error; a few
  opinionated rules (`typescript/no-non-null-assertion`,
  `react/no-array-index-key`, `react/exhaustive-deps`) are `warn` so they
  surface without blocking — tighten them to `error` as the code is cleaned up.
  CI fails on errors only, which is the posture Biome ran with before it. The
  `overrides` block is what keeps `packages/core` platform-free: browser globals
  and `react-dom`/stylesheet imports are errors there, and `react` itself is an
  error outside `packages/core/src/react`. See
  [`packages/core/README.md`](../packages/core/README.md).

  Three ways this config fails **silently**, all covered by
  `packages/core/src/oxlintConfig.test.ts` — read that file before editing it:

  1. An unknown rule name makes oxlint discard the whole `rules` object it sits
     in. The rule is configured as `react/exhaustive-deps` even though the
     diagnostic prints `react-hooks(exhaustive-deps)`.
  2. `overrides` **replace** a rule's options instead of merging them, so both
     `packages/core` overrides must restate the `react-dom`/stylesheet patterns.
  3. A nested `.oxlintrc.json` replaces the root config for its entire subtree.
     `apps/web` shipped one from the Vite React scaffold; it sat inert under
     Biome and took over the moment oxlint started running.
- **oxfmt** (`.oxfmtrc.json`) — the formatter, and the import sorter that
  replaced Biome's `organizeImports` assist. `sortImports.newlinesBetween` is
  `false` deliberately: the default inserts a blank line between the external
  and relative import groups, which is a ~180-file reformat for no gain.
  Markdown, YAML, CSS and `public/` assets are excluded, matching what Biome
  actually formatted.
- **Vitest coverage** (`apps/web/vite.config.ts`, `packages/core/vitest.config.ts`)
  — thresholds are a ratchet set just below current coverage. Raise them as tests
  are added; the domain layer in `packages/core` is near 100% and the web feature
  components are the gap.
- **convex-test** (`packages/convex/vitest.config.ts`) — runs Convex functions
  against an in-memory backend. See `packages/convex/convex/groceryList.test.ts`.
- **golangci-lint** (`apps/recipe-service/.golangci.yml`) — the standard linter
  set plus `misspell`/`unconvert`.
- **Knip** (`knip.json`) — flags unused files, exports, and dependencies.
- **Design-token drift guard** (`apps/web/scripts/generate-theme-css.mjs`) —
  `apps/web/src/theme.generated.css` is rendered from `@pantry/design-tokens`,
  so `--check` re-renders and compares, and also verifies the spacing scale
  against its own base multiplier. It runs from both `test` and `test:coverage`,
  because CI runs the latter. It is a script rather than a vitest test on
  purpose: the natural test imports the stylesheet with `?raw`, and the web
  suite runs with `css: false`, which resolves such imports to `""` — the
  assertion would pass against nothing.

## One-time repository settings (needs admin)

These live in GitHub repo settings, not in code, so an admin must enable them:

1. **Branch protection for `main`** — Settings → Branches → add a rule:
   - Require a pull request before merging.
   - Require status checks to pass: select **Node (lint · typecheck · test ·
     build)** and **Go (vet · test · lint · vuln)**.
   - Require branches to be up to date before merging.
   This is what actually stops a red PR from landing.
2. **Secret scanning + push protection** — Settings → Code security → enable
   *Secret scanning* and *Push protection*. Blocks committed credentials
   (relevant given the Convex/auth work and `.env.example`). Free on private
   repos.
3. **Dependabot alerts** — Settings → Code security → enable *Dependabot
   alerts* (and security updates). Free on private repos; surfaces known CVEs
   in our npm and Go dependencies.

## Cost

GitHub Actions is free for this project's needs: private repos on the Free plan
include 2,000 Linux minutes/month (3,000 on Team). A full CI run here is a few
minutes and Turborepo caching skips unchanged packages, so real usage is a small
fraction of the quota. Dependabot, secret scanning, and push protection are free
on private repos. CodeQL code scanning is **not** free on private repos (it
needs GitHub Advanced Security) — see the note above.
