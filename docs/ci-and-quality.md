# CI & Code Quality

This repo runs automated checks on every pull request via GitHub Actions. With
many contributors (human and agent) landing changes, these are the guardrails
that keep `main` green.

## What runs on every PR

`.github/workflows/ci.yml` has two jobs:

| Job | Steps |
| --- | --- |
| **Node** | oxlint (syntax lint) · oxfmt (format + import order) · backlog index freshness · contract codegen freshness · TypeScript typecheck · Vitest with coverage (incl. design-token drift guard) plus `jest-expo` for `apps/mobile` · build · oxlint --type-aware · Knip (dead code / unused deps) |
| **Go** | `gofmt` check · `go vet` · `go test -race -cover` (incl. the OpenAPI conformance tests) · `golangci-lint` · `govulncheck` (advisory) |

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
pnpm lint             # oxlint (syntax) + oxfmt --check (TS) + go vet (via turbo)
pnpm lint:types       # builds workspace deps, then oxlint --type-aware
pnpm format           # oxfmt (format + import order), then oxlint --fix
pnpm typecheck        # tsc across all packages
pnpm test             # Vitest + jest-expo (apps/mobile) + go test
pnpm test:coverage    # Vitest with coverage thresholds enforced
pnpm knip             # unused files / exports / dependencies
pnpm check            # lint + contract check + typecheck + lint:types + test in one shot
pnpm backlog:index    # regenerate the docs/backlog/README.md index table
pnpm contract:codegen # regenerate the wire types from contract/openapi.yaml
```

The backlog index table is generated from each item's frontmatter
(`scripts/backlog-index.mjs`) so parallel agents stop conflicting on one
hand-maintained table. CI runs `pnpm backlog:index:check`, which regenerates
in-memory and fails if the committed table is stale — run `pnpm backlog:index`
and commit the result.

The recipe-service HTTP contract is written once, in
[`contract/openapi.yaml`](../contract/openapi.yaml). CI runs
`pnpm contract:check`, which re-renders the TypeScript wire types and the Go
conformance table and fails if either committed file is stale — run
`pnpm contract:codegen` and commit the result. The Go structs are not generated
from the spec but *checked against* it, by the tests in
`apps/recipe-service/internal/contract`; see
[`contract/README.md`](../contract/README.md) for why, and for what the check can
and cannot see.

Three heavier suites are **not** part of the per-PR gate and run on demand:

```bash
pnpm test:integration  # cross-service contract (Convex ⇄ recipe-service ⇄ Postgres)
pnpm test:e2e          # full loop in a real browser (Playwright) against a compose stack
pnpm test:e2e:mobile   # Maestro flows on a simulator/emulator, against the same stack
```

`test:e2e` (see [`README.md`](../README.md#end-to-end-browser)) drives the whole
user loop against a live stack; it needs Docker, Go, and a Playwright browser
(`pnpm --filter @pantry/web exec playwright install --with-deps chromium`), so it
stays out of the fast unit gate.

`test:e2e:mobile` (BL-0072, see [`mobile-e2e.md`](mobile-e2e.md)) is the device
equivalent, and is further out still: it needs a native build and a booted iOS
simulator or Android emulator, plus — on Linux — a runner whose `/dev/kvm` it
can actually open. It runs nightly rather than per PR
(`.github/workflows/nightly-mobile-e2e.yml`, BL-0073), and its two device jobs
are **gated on repository variables** so nobody turns on a macOS runner by
accident; `mobile-e2e.md` has the switches, the costs and the triage rule for a
red run. What the PR gate carries for it is static: `apps/mobile`'s jest suite
parses the Maestro flows, renders the screens they drive, and compares the flow
set against `apps/web/e2e`, so a renamed `testID` or a new Playwright spec with
no native answer fails a pull request rather than a nightly run.

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
  CI fails on errors only, which is the posture Biome ran with before it, and
  those three are the only warnings a clean run prints — keep it that way, or
  the warnings stop being read. The `overrides` block is what keeps
  `packages/core` platform-free: browser globals and `react-dom`/stylesheet
  imports are errors there, and `react` itself is an error outside
  `packages/core/src/react`. See
  [`packages/core/README.md`](../packages/core/README.md).

  Two rules are deliberately off. `react/only-export-components` (a Vite
  scaffold default) fires on every TanStack route file and on components that
  export a helper constant — 9 warnings that no reviewer was ever going to act
  on. `typescript/unbound-method` is off in test files only, where
  `expect(mock.method)` is the normal way to assert on a mock and the
  unbound-`this` hazard it warns about does not exist.

- **`pnpm lint:types`** — oxlint again, with **`--type-aware`** (the
  `oxlint-tsgolint` package). This is the one thing the previous linter could
  not do at all: rules that need the type checker rather than just the syntax
  tree. `typescript/no-floating-promises` is the reason it is worth the extra
  ~2.4s — an un-awaited promise is invisible to a syntax-only linter, and this
  repo fires a lot of them deliberately. The deliberate ones now say so with
  `void`; a new one that is *not* deliberate fails CI rather than silently
  dropping a rejection. Also live: `no-base-to-string` (caught a real
  `"[object Object]"` risk in the OTLP span exporter), `no-misused-spread`,
  `require-array-sort-compare`.

  **It is a separate script because it needs `dist/` to exist**, the same
  reason `typecheck` carries `dependsOn: ["^build"]` in `turbo.json`. Type-aware
  rules resolve `@pantry/*` through each package's emitted `.d.ts`, so running
  it on a clean checkout without building first turns every workspace type into
  an `error` type and produces ~17 bogus `no-redundant-type-constituents`
  failures — and a *stale* `dist/` is worse, because it lints green against
  stale types. `lint:types` therefore runs `turbo run build` itself (cached, so
  it is nearly free once warm), and CI runs the type-aware pass **after** its
  build step. Plain `pnpm lint` stays syntax-only and needs nothing built, which
  is what keeps it a ~0.1s pre-push check.

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
- **Contract codegen** (`scripts/contract-codegen.mjs`) — renders
  `packages/types/src/contract.generated.ts` and
  `apps/recipe-service/internal/contract/spec_gen_test.go` from
  `contract/openapi.yaml`. It understands a deliberately small subset of
  OpenAPI 3.1 and throws on anything else rather than dropping it, because a
  generator that silently skips a field hides exactly the drift it exists to
  catch. Generated TypeScript is excluded from oxlint and oxfmt via the
  `**/*.generated.ts` ignore pattern in both configs.
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
