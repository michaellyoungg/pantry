# CI & Code Quality

This repo runs automated checks on every pull request via GitHub Actions. With
many contributors (human and agent) landing changes, these are the guardrails
that keep `main` green.

## What runs on every PR

`.github/workflows/ci.yml` has two jobs:

| Job | Steps |
| --- | --- |
| **Node** | Biome (lint + format + import order) · TypeScript typecheck · Vitest with coverage · build · Knip (dead code / unused deps) |
| **Go** | `gofmt` check · `go vet` · `go test -race -cover` · `golangci-lint` |

`.github/workflows/codeql.yml` runs GitHub CodeQL security analysis for
JavaScript/TypeScript and Go on PRs, pushes to `main`, and weekly.

`.github/dependabot.yml` opens weekly dependency-update PRs for npm, Go modules,
and the GitHub Actions we use.

## Running the checks locally

Everything CI runs is available through pnpm from the repo root:

```bash
pnpm lint            # Biome (TS) + go vet (via turbo)
pnpm format          # Biome: auto-fix formatting, imports, safe lint fixes
pnpm typecheck       # tsc across all packages
pnpm test            # Vitest + go test
pnpm test:coverage   # Vitest with coverage thresholds enforced
pnpm knip            # unused files / exports / dependencies
pnpm check           # lint + typecheck + test in one shot
```

Go tooling (run from `apps/recipe-service`):

```bash
gofmt -l .           # lists unformatted files (should be empty)
go vet ./...
go test -race ./...
golangci-lint run    # install: https://golangci-lint.run/welcome/install/
```

## Tooling reference

- **Biome** (`biome.json`) — linter + formatter for JS/TS. A few opinionated
  rules (`noNonNullAssertion`, `noArrayIndexKey`, `useExhaustiveDependencies`)
  are set to `warn` so they surface without blocking; tighten them to `error`
  as the code is cleaned up. CSS and `public/` static assets are excluded.
- **Vitest coverage** (`apps/web/vite.config.ts`) — thresholds are a ratchet set
  just below current coverage. Raise them as tests are added; the `src/lib`
  layer is already near 100% and the feature components are the gap.
- **convex-test** (`packages/convex/vitest.config.ts`) — runs Convex functions
  against an in-memory backend. See `packages/convex/convex/groceryList.test.ts`.
- **golangci-lint** (`apps/recipe-service/.golangci.yml`) — the standard linter
  set plus `misspell`/`unconvert`.
- **Knip** (`knip.json`) — flags unused files, exports, and dependencies.

## One-time repository settings (needs admin)

These live in GitHub repo settings, not in code, so an admin must enable them:

1. **Branch protection for `main`** — Settings → Branches → add a rule:
   - Require a pull request before merging.
   - Require status checks to pass: select **Node (lint · typecheck · test ·
     build)** and **Go (vet · test · golangci-lint)**.
   - Require branches to be up to date before merging.
   This is what actually stops a red PR from landing.
2. **Secret scanning + push protection** — Settings → Code security → enable
   *Secret scanning* and *Push protection*. Blocks committed credentials
   (relevant given the Convex/auth work and `.env.example`).
3. **CodeQL / Dependabot alerts** — Settings → Code security → enable
   *Dependabot alerts* and *Code scanning*. The workflows above populate them.

## Cost

GitHub Actions is free for this project's needs: private repos on the Free plan
include 2,000 Linux minutes/month (3,000 on Team). A full CI run here is a few
minutes and Turborepo caching skips unchanged packages, so real usage is a small
fraction of the quota. CodeQL, Dependabot, and secret scanning are free.
