# Tailwind UI Refresh Design Spec

> A visual refresh of the `apps/web` UI: adopt Tailwind v4 and restyle every
> surface with a warm, modern "appetizing" aesthetic. Behavior, data, and the
> existing optimistic-update / error-surfacing wiring are unchanged.

## Goal

Replace the minimal plain-CSS UI with a cohesive, modern, warm-themed design
built on Tailwind v4 and a small set of owned UI primitives — improving spacing,
hierarchy, responsiveness, and polish without changing any behavior.

## Context

The web app (`apps/web`, React 19 + Vite 8 + TS) currently has ~9 hand-written
CSS rules in `App.css` and five surfaces: `RecipeForm`, `RecipeList`, `Basket`,
`GroceryList`, and the `RecipeEditDialog` (native `<dialog>`). Layout is a fixed
2-column grid. The app has jsdom + @testing-library/react (added in BL-0012);
`GroceryList.test.tsx` asserts `role="checkbox"` and `role="alert"`, and the
`recipeService` tests are pure logic — all must keep passing.

## Decisions (from brainstorming)

- **Scope:** restyle + light layout polish. Keep the 4-panel + dialog
  information architecture; add a real app-shell header and make the grid
  responsive. No behavior/data/logic changes.
- **Aesthetic:** warm & appetizing — cream page, herb-green primary, terracotta
  destructive, rounded cards, soft shadows.
- **Tailwind v4** (CSS-first, `@tailwindcss/vite` plugin; no `tailwind.config.js`).
- **Small local UI primitives** (`Button`, `IconButton`, `Card`, `Input`) — no
  new runtime deps beyond Tailwind.
- **Light theme only**; design tokens as CSS variables so dark mode can be
  layered later without component rework.

## Section 1 — Tailwind v4 setup

- Add dev-deps: `tailwindcss` (v4) and `@tailwindcss/vite`.
- Register the plugin in `apps/web/vite.config.ts`:
  ```ts
  import tailwindcss from "@tailwindcss/vite";
  // plugins: [react(), tailwindcss()]
  ```
- Create `apps/web/src/index.css` with `@import "tailwindcss";` and the `@theme`
  token block (Section 2). Change `main.tsx` to `import "./index.css"` and
  delete `App.css`.
- The retired `App.css` rules (`.container`, `.grid`, `.panel`, `.error`,
  `.ingredient-row`, input/button) are reimplemented via utilities/primitives;
  the `.error` styling moves onto the `ErrorText` component's classes.

## Section 2 — Design tokens (warm palette)

Defined in the `@theme` block as CSS custom properties so a future dark theme can
override them:
- `--color-bg`: warm cream page background (≈ `#faf7f2`).
- `--color-surface`: card background (`#ffffff`).
- `--color-border`: hairline border (≈ stone-200 `#e7e5e4`).
- `--color-primary` / `--color-primary-hover`: herb-green (≈ `#3f7d4e` /
  `#356b43`) — primary actions.
- `--color-danger` / `--color-danger-hover`: terracotta (≈ `#c0562f` /
  `#a8481f`) — Delete/Remove.
- `--color-text` / `--color-muted`: body / secondary text (≈ stone-800
  `#292524` / stone-500 `#78716c`).
- Radius scale: cards `rounded-xl`, controls `rounded-lg`. Shadow: soft
  `shadow-sm`.

**Token mechanism:** in Tailwind v4, color tokens declared in `@theme` as
`--color-<name>: <hex>;` automatically generate the matching utilities
(`bg-<name>`, `text-<name>`, `border-<name>`, etc.). So the palette above is
declared once in the `@theme` block (e.g. `--color-primary: #3f7d4e;`) and the
primitives reference `bg-primary` / `text-primary` / `border-border` / etc. A
later dark theme overrides the same `--color-*` variables under a `.dark`
selector without touching any component. The hex values above are the design
intent; the plan may fine-tune exact shades but keeps this token structure.

## Section 3 — UI primitives (`apps/web/src/components/ui/`)

Small, owned, Tailwind-styled. Each preserves native semantics so existing tests
keep working.

- **`Button`** — props: `variant?: "primary" | "secondary" | "ghost" | "danger"`
  (default `primary`), `size?: "sm" | "md"` (default `md`), plus all native
  `<button>` props via `React.ButtonHTMLAttributes<HTMLButtonElement>` spread.
  Renders a real `<button>` so `onClick`, `disabled`, and text content are
  intact. Variant → Tailwind classes; disabled state dims + `cursor-not-allowed`.
- **`IconButton`** — compact square button for icon/`×` actions; same native
  spread; accepts `aria-label`.
- **`Card`** — props: `title?: string`, `children`, optional `className`.
  Renders a `<section>`/`<div>` with surface bg, border, `rounded-xl`,
  `shadow-sm`, padding; renders an `<h2>` when `title` is set. Panels use it as
  their shell.
- **`Input`** — styled `<input>`, forwards all native props
  (`React.InputHTMLAttributes<HTMLInputElement>`); consistent focus ring.

`ErrorText` is updated to Tailwind classes (warm danger color, small) but keeps
`role="alert"`.

## Section 4 — App shell + panel restyle

- **App shell (`App.tsx`):** a header with a simple mark (inline SVG or emoji)
  + "Pantry" wordmark and a subtle bottom border; a centered `max-w` container
  with warm page background applied at the body/root; a responsive grid —
  **1 column on mobile, `md:` 2 columns** (currently always 2).
- **Panels rebuilt on `Card` + primitives:**
  - `RecipeForm` — Card titled "New recipe"; `Input`s for title/ingredient rows;
    `+ ingredient` as a `secondary`/`ghost` Button; submit as `primary`
    (disabled/"Saving…" via existing `pending`); `ErrorText` below.
  - `RecipeList` — Card titled "Recipes"; each row shows the title emphasized
    with muted meta, and `Add to basket` (primary/secondary), `Edit` (ghost),
    `Delete` (danger) actions; empty state styled; `ErrorText` at the panel.
  - `Basket` — Card titled "Basket"; rows with `Remove` (danger/ghost);
    `Generate grocery list` primary button with its `gen.pending` label; combined
    `ErrorText`.
  - `GroceryList` — Card titled "Grocery list"; checkbox rows with strike-through
    on checked (preserved), muted quantities; `ErrorText`.
  - `RecipeEditDialog` — the native `<dialog>` restyled as a centered modal card
    with a dimmed backdrop (`::backdrop`), Card-like body, `Save` primary /
    `Cancel` ghost.
- **No behavior/data/logic changes** — handlers, roles, test hooks, optimistic
  updates, and error wiring are untouched; only markup/classes and the
  raw-element → primitive swaps change.

## Section 5 — Testing & verification

- **Existing tests unchanged and green** — `GroceryList.test.tsx`
  (`getByRole("checkbox")`, `findByRole("alert")`), `useAsyncAction`,
  `optimistic`, and `recipeService` tests. This is the guardrail proving the
  restyle didn't break wiring. (If a primitive swap changes a query target, that
  is a regression to fix, not a test to loosen.)
- **New primitive tests** (`apps/web/src/components/ui/`):
  - `Button`: renders a `<button>` with its children; applies the requested
    variant (assert a stable data attribute or role + accessible name, not exact
    class strings); forwards `onClick` and honors `disabled`.
  - `Card`: renders its `title` as a heading and its children.
  (Assert semantics/behavior, not Tailwind class strings — class assertions are
  brittle.)
- **Build gate:** `pnpm --filter @pantry/web build` (`tsc -b` + `vite build`,
  which also proves Tailwind compiles) + `( cd apps/web && pnpm test )`.
- **Manual visual smoke (controller-run, web-only, no rebuild):** app renders the
  warm theme; panels cohesive; grid collapses to one column at mobile width; edit
  dialog is a centered modal with backdrop; primary/danger buttons read clearly.

## Out of scope

- Dark mode (tokens make it a later add).
- An icon library or illustrations beyond a simple mark + a couple inline
  SVGs/emoji.
- Animations beyond subtle CSS transitions (hover/focus).
- Any information-architecture / layout rethink (nav, sidebar, routing).
- Behavior, data model, or backend changes.
