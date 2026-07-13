# Pantry — Design: URL Import + Recipe Parser (BL-0001)

- **Date:** 2026-07-12
- **Status:** Approved
- **Author:** myoung (with Claude)
- **Backlog:** [BL-0001](../../backlog/BL-0001-url-import-recipe-parser.md)
- **Branches off:** [2026-06-29 recipe-to-grocery-list design](2026-06-29-recipe-to-grocery-list-design.md)

## Goal

Turn a recipe URL into a structured `Recipe` matching the existing
`Recipe{title, ingredients[]}` shape, surfaced in the web app as an **editable
preview** the user confirms before it is saved to the canonical store. Parsing
is never perfect, so a human reviews every import before it reaches the
recipe-service.

## Where it lives

Inside the existing Go **`recipe-service`**, as a new package (`internal/recipeimport`).
recipe-service is already the canonical source of truth for recipe definitions;
import produces the same `Recipe` shape its store consumes, so import belongs
here rather than in a new deployable or in the browser. It may split into its own
service later if it earns one (per BL-0001), but starts in-process.

## Architecture

```
POST /recipes/import { url }
        │
        ▼
   1. fetch(url)        → HTML        (guarded HTTP client)
   2. extract           → { title, ingredientLines[], steps[] }
        ├─ JSON-LD path (schema.org Recipe)   ← common case, deterministic
        └─ LLM fallback (Claude)              ← only when no usable JSON-LD
   3. parseLines        → []Ingredient{quantity,unit,item,note}   (deterministic)
        ▼
   returns a Recipe PREVIEW (NOT persisted) → web edit form → existing POST /recipes
```

**Critical detail:** schema.org JSON-LD exposes ingredients as free-text strings
(`recipeIngredient: ["2 cloves garlic, minced", ...]`), so the deterministic
**line parser** runs on the JSON-LD path. The LLM fallback returns
*already-structured* ingredients and therefore skips the line parser — it is used
only when a page has no usable `Recipe` JSON-LD.

The import endpoint returns a **preview** `Recipe` (no id, not stored). The web
app drops it into the existing manual-entry/edit form; the user reviews and saves
through the existing `POST /recipes` path. No new persistence is added.

## Components

Each unit has one purpose, a narrow interface, and is testable in isolation.

### 1. `fetcher` — URL → HTML (I/O boundary)
HTTP GET with guardrails:
- scheme allowlist (`http`/`https` only)
- request timeout
- response-size cap (in the spirit of the existing `maxBodyBytes` = 1 MiB)
- redirect cap
- SSRF guard: reject loopback / private / link-local IP targets (cheap and
  correct even for a self-hosted single-user app; the server fetches
  user-supplied URLs)

Behind an interface so the handler tests inject a fake and never hit the network.

### 2. `jsonld` — HTML → extracted recipe (deterministic, no network)
Parse `<script type="application/ld+json">` blocks and locate a `Recipe`:
- handle a top-level object, an array, and an `@graph` wrapper
- handle `@type` being a string **or** a list containing `"Recipe"`
- pull `name`, `recipeIngredient[]`, and `recipeInstructions` (steps)
- return "not found" cleanly so the handler can fall back to the LLM

Table-tested against saved real-world recipe HTML fixtures.

### 3. `lineparser` — free-text ingredient line → `Ingredient` (pure function)
`"2 cloves garlic, minced"` → `{quantity: 2, unit: "clove", item: "garlic", note: "minced"}`.
Handles:
- integer, decimal, unicode-fraction (`½`), and `1 1/2` quantities
- ranges (`1-2` → take the low or a defined rule; documented in code)
- a units vocabulary; unknown units → `unit: ""`
- a trailing `, note` clause
- unparseable lines → `{quantity: 0, unit: "", item: <whole line>}` — the
  existing normalizer already tolerates unknown items/units, so nothing breaks
  downstream.

Heavily unit-tested; this is the highest-value deterministic logic in the slice.

### 4. `llm` — `Extractor` interface + Claude-backed impl (the fallback seam)
```go
type Extractor interface {
    Extract(ctx context.Context, pageText string) (Recipe, error)
}
```
- Claude-backed implementation via `github.com/anthropics/anthropic-sdk-go`.
- Model: **`claude-haiku-4-5`** — recipe extraction is a simple, high-volume
  extraction task; Haiku is fast, cheap, and supports structured outputs. (House
  default is Opus 4.8; Haiku chosen deliberately for cost/latency here.)
- Uses **structured output** (strict tool use / JSON-schema `output_config`) so
  the model returns a validated `{title, ingredients[]}` object, not prose.
- Input is **cleaned page text** (scripts/styles/nav stripped), not raw HTML, to
  bound tokens.
- Adaptive thinking not enabled (unnecessary for extraction).

**Graceful degradation:** if `ANTHROPIC_API_KEY` is unset, the fallback is
disabled (`Extractor` is nil). A page with no usable JSON-LD then returns `422`
with a clear "couldn't parse automatically — enter manually" message. The
JSON-LD path is unaffected, so the feature works offline and in CI.

### 5. `handler` — `POST /recipes/import`
- Wired into `NewRouter`, behind the existing `requireService(secret, …)` auth.
- Request `{ "url": "..." }`; validates and size-limits the body like the other
  handlers (`decodeJSON`).
- Success → `200` with a preview `Recipe` (no id, `userId` from context, not
  persisted).
- `400` bad/blocked URL or malformed body; `422` when extraction fails and no
  LLM fallback is available; `502`/`504`-class mapped to a `422`-style "couldn't
  fetch/parse" for the client (exact codes finalized in the plan).

## Data / contract

- No schema change. Import returns the existing `Recipe`/`Ingredient` shape.
- **Steps:** JSON-LD and the LLM both surface instruction steps; this slice
  **extracts but does not persist** them, because the store currently holds only
  `{title, ingredients}`. Persisting steps is a separate schema change (candidate
  follow-up backlog item). Steps may be shown in the preview UI as read-only
  context but are not saved.
- The TS/Go hand-mirrored contract (per the M1 design's known-drift note) gains
  the `POST /recipes/import` request/response; mirror both sides.

## Config

- New env var `ANTHROPIC_API_KEY` for `recipe-service`: add to `.env.example`
  and pass through in `docker-compose.yml`. Absent ⇒ graceful degrade (above).

## Web

- Import control on the recipes page: URL input → `POST /recipes/import` → populate
  the existing edit/manual-entry form with the returned preview → user reviews /
  corrects → save via the existing `POST /recipes` path.
- No new persistence logic on the web side; reuse the form and save flow already
  built for manual entry / edit.

## Testing

- `jsonld`: table tests over saved recipe-page HTML fixtures (including
  `@graph`, list `@type`, and no-Recipe pages).
- `lineparser`: table tests over tricky ingredient lines (fractions, ranges,
  unknown units, notes, junk).
- `fetcher`: `httptest` server exercising redirects, timeout, size cap, and
  SSRF rejects.
- `handler`: JSON-LD happy path (fake fetcher); fallback path (fake `Extractor`);
  `422` when `Extractor` is nil.
- **No live Claude calls in tests** — the `Extractor` interface is the seam.

## Non-goals (this slice)

- Persisting recipe steps (separate schema change / follow-up).
- Batch / bulk import.
- Browser-side parsing.
- Image / OCR / video recipes.
- Caching or dedup of imported recipes (BL-0013 covers dedup separately).

## Alternatives considered

| Decision | Chosen | Rejected alternative |
|---|---|---|
| Where it lives | In-process in Go recipe-service | New TS/LLM deployable now (premature) |
| Extraction | JSON-LD first, LLM fallback | LLM for everything (cost, non-determinism, untestable) |
| Line parsing | Deterministic Go parser | LLM per line (slow, costly for the common case) |
| Import UX | Editable preview, then save | Import straight to canonical store (silent mis-parses) |
| Fallback model | Haiku 4.5 | Opus 4.8 (overkill/cost for bulk extraction) |
| Steps | Extract, don't persist yet | Expand schema now (out of scope for the slice) |
| Missing API key | Graceful degrade to 422 | Hard-require the key (breaks offline/CI) |
