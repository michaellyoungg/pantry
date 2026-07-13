# Pantry — Full-App UX Plan (North Star + Roadmap)

*Date: 2026-07-12. Status: draft for review. Persona: **busy household cook** planning a
week of family meals. Platform: **responsive web, mobile-aware** (desktop/tablet to plan,
phone in-store and in-kitchen). Grounding: **buildable on the current stack now**, with a
clearly-labelled **vision layer** for later.*

This document synthesizes five parallel UX research briefs (meal planning, recipe import,
grocery list, pantry/waste, and information architecture) into one coherent plan. It is a
**north star**, not a single implementation spec — it decomposes into sub-projects that each
get their own spec → plan → build cycle (see [Roadmap](#roadmap) and the new backlog items).

---

## 1. The thesis

**Pantry is a weekly-loop app: Plan → Build List → Shop → Cook → (Pantry) → repeat.**

The research surfaced one strategic fact that should shape every decision:

> **Pantry already owns the expensive half of this product.** The Go `recipe-service` already
> normalizes ingredients (synonyms), converts units, groups by aisle, and de-dups/merges
> across recipes (BL-0003, done). Convex gives AnyList-class real-time sync essentially for
> free. Every competitor fights hardest for exactly these two assets.

The competitive gap is therefore **almost entirely in presentation and information
architecture**, not the backend. The whole app is currently a single `/` route rendering five
components in one flat grid — nothing is prioritized, and every new feature has only one place
to go: the pile. Fixing the *structure* is the highest-leverage first move.

**Design principle throughout: be anti-friction.** The loudest signal across all five briefs
is that these apps die from admin burden, not missing features — rigid planners abandoned in
days, pantry trackers that decay to a "fossil record" by week four. Spend the UX budget making
"plan a week → one reliable grocery run" feel like five minutes of tapping.

---

## 2. Information architecture

**Five responsive destinations**, same everywhere; only the chrome changes:

- **Desktop (≥1024px):** left **sidebar** (labelled icons) + persistent "Add / Import" action.
- **Tablet (640–1024px):** collapsed **icon rail**.
- **Phone (<640px):** **bottom tab bar**, 5 items, thumb-reachable.

| # | Tab | Route | Owns |
|---|---|---|---|
| 1 | **Home** | `/` | This week at a glance; state-aware next action; shopping-day handoff |
| 2 | **Plan** | `/plan` | Week grid + the basket; assign recipes to days; "Generate list" |
| 3 | **Recipes** | `/recipes` | My recipes, import (URL/manual), browse catalog, recipe detail |
| 4 | **List** | `/list` | The single aggregated, live, check-off-in-store grocery list |
| 5 | **Pantry** | `/pantry` | What I have; don't-rebuy; cook-from-pantry (vision-leaning) |

Key IA decisions:

- **Basket folds into Plan.** The basket is the staging area for the week; Plan is where you
  assemble it. Keeps us under the 5-tab ceiling.
- **Import folds into Recipes** as an action, not its own tab — a way to fill the recipe box.
- **Settings/profile behind a menu**, never a tab (household size, diet, allergies, auth).
- **Pantry stays a first-class tab** even though it's the least built — it's a core pillar;
  near-term it's a thin "add staples" screen so the slot (and the vision) has a home.

### Sitemap

```
/                  Home       — week strip · one state-aware CTA · shopping-day handoff card
/plan              Plan       — week grid (desktop) / agenda (mobile) + basket rail → Generate list
/recipes           Recipes    — my recipes + [Import URL]/[Add manually]
  /recipes/catalog            — browse canonical catalog (search + filters)
  /recipes/$id                — recipe detail → [Add to plan] [Add to list]
/list              List       — aggregated, aisle-grouped, live check-off + shopping mode
/pantry            Pantry     — staples + on-hand · don't-rebuy · cook-from-pantry (vision)
/settings          (menu)     — household, diet, allergies, sign out
```

All of this is buildable now on TanStack Router by splitting `index.tsx` into file-based
routes and adding **one responsive nav shell in `__root.tsx`** — no new dependencies.

---

## 3. The core journey (the weekly loop)

```
 SUN night          then              SHOPPING DAY          MON–FRI            repeat
┌──────────┐      ┌──────────┐       ┌────────────┐       ┌────────┐
│  PLAN    │  →   │ BUILD    │   →   │   SHOP     │   →   │  COOK  │  →  back to PLAN
│  /plan   │      │ LIST     │       │ /list      │       │/recipes│
│ (desk)   │      │ /list    │       │ (phone,    │       │/pantry │
└──────────┘      └──────────┘       │  in-store) │       └────────┘
                                     └────────────┘
```

**Home** is the glue: a read-and-route surface that answers "what do I do now?" with a single
state-aware CTA:

- No plan yet → **"Plan this week"** → `/plan`
- Plan exists, no list → **"Build grocery list (23 items)"** → `/list`
- List built → **"Shopping day — 23 items ready → Shop"** → `/list` shopping mode

The **shopping-day handoff card** (plan on the couch → shop on the phone) is the single
highest-value cross-cutting moment; make it big and obvious.

**The three screens to build best:** `/plan` (the reason the product exists), `/list` in
shopping mode (the moment of truth — one-handed, in-store, possibly co-shopped), and `/` Home.

---

## 4. Per-area design direction

### 4a. Plan — meal planner

- **The basket becomes the plan.** Add three fields per basket entry: `plannedDate`/week-id,
  `slot` (default `"dinner"`), `servingsMultiplier` (default household size), and an entry
  `type` (`meal` | `leftover`). Reuse aggregation as-is; pass the multiplier through.
- **Dinner-first 7-day view.** Don't render breakfast/lunch as demanding empty blanks — a
  subtle "+ add" affordance only. Real families plan dinner first.
- **Desktop = week grid + recipe rail; mobile = vertical agenda** (not a squished 7-column
  grid). "Add to plan" from any recipe → bottom-sheet day/slot picker.
- **Near-term: tap "Add to day" / "Move to…". Defer drag-and-drop to vision** — most-praised
  feature but desktop-first and expensive on touch.
- **Servings stepper** on each card flows into grocery quantities (that's the only place
  scaling has value, and it's exactly where aggregation already lives).
- **Leftovers** = an entry that occupies a slot but contributes **nothing** to the grocery
  list ("cook once, eat twice"). Almost nobody does this well; cheap for us.
- **Support two rhythms:** the weekly ~20-min Sunday session *and* a "what's tonight / add to
  today" path for the non-planner cohort.

### 4b. Recipes — import & discovery

- **One "Add Recipe" funnel, four entry points → one review-and-edit screen.** URL paste ·
  manual · catalog · (photo, later) all converge on the same editable screen. **Never save a
  parse silently** — the review screen is the norm across every leading app, and it's a
  feature, not an apology.
- **URL import via schema.org/Recipe JSON-LD, parsed server-side in Go.** Most serious recipe
  sites publish JSON-LD for SEO, and the recipe-service already produces the exact
  `{quantity, unit, item, note}` shape. This makes BL-0001 **much cheaper than its "L"
  estimate** if scoped to JSON-LD + a paste-text fallback + graceful manual degradation.
- **Failure is never a dead end** — pre-fill the manual form with whatever was extracted.
- **Catalog needs search + filter chips** the busy cook cares about: **cook time** (#1
  weeknight filter), diet, cuisine. Requires light schema additions (below).
- **The import review screen and the edit dialog should be one component.**

### 4c. List — smart grocery list

- **Aisle sections** (data already grouped by the Go service), collapsible, with counts.
- **Tap-to-check is primary**; checked items strike through and **animate to an "In cart"
  section** so the top is always "what's left." Swipe is an accelerator only, never the sole
  path (swipe-away = delete, with undo).
- **Recipe provenance:** each aggregated line shows "N recipes"; a detail sheet lists the
  contributing recipes and amounts, each tappable to the recipe (AnyList's proven model — and
  our aggregator already retains the source entries).
- **One-handed ergonomics:** primary actions (add, check, "Done") in the bottom thumb zone.
- **"Done shopping" flow:** remove-purchased vs keep-unbought; (vision) add purchased to
  pantry.
- **Convex gives live household sync for free** — presence + highlight on remote change.

### 4d. Pantry — inventory & waste (build the *thin* loop only)

Pantry-tracking is a **feature graveyard** — apps die from data-entry friction and inventory
staleness, not lack of demand. **Do not build "log everything in your kitchen."** Build the
one loop the market has left open, which fits our stack perfectly:

- **Inflow: auto-add from grocery check-off.** Checking an item off the live list *becomes* a
  pantry item (same normalized ingredient id — no re-typing, no duplicates). This is the wedge
  competitors miss.
- **Outflow: cook-decrement.** Marking a planned recipe "cooked" subtracts its ingredients.
  This is the only outflow signal that survives real use — and it **depends on the planner's
  "mark cooked" event**, so it gates the whole feature.
- **Category-default expiry** (from a shelf-life table on the normalized ingredient) — users
  never hand-enter dates; batched, actionable "3 items to use this week → cook these" nudges.
- **"Don't rebuy":** the grocery list diffs against pantry and greys/pre-checks what's on hand.
  This is the tangible, money-saving win that justifies the whole feature — and the reason
  Pantry earns its keep for this persona (waste reduction is *secondary* to them).
- Track a **narrow, auto-maintained set** (auto-added perishables + a small user-curated
  staples list as have/low), and be honest it's approximate. Resist modeling exact quantities.

---

## 5. Cross-cutting decisions to make (need your call) {#decisions}

These are the choices that ripple across areas. My recommendation is in **bold**.

1. **Week identity now or later?** **Model a week id now** — it's cheap, and users plan next
   week while this week's list is live. Retrofitting later is painful.
2. **List regeneration semantics** (the biggest UX trap): when the plan changes after a list
   exists — auto-sync, manual regenerate, or **diff-merge preserving checked items**? Touches
   the live grocery model; decide before building the handoff. **Recommend diff-merge.**
3. **Offline in-store use.** A reactive web app that white-screens in a store dead zone loses
   to native rivals. Is **offline PWA** a vision item or closer to a near-term must for the
   in-store persona? Flagged as the highest-leverage vision investment. **Recommend: plan for
   it early, ship after the core loop.**
4. **Recipe schema extensions.** Add `sourceUrl` (attribution + re-import), `cuisine`,
   `totalMinutes`, `tags[]` (discovery filters), and decide on **instructions** — the `Recipe`
   struct stores ingredients only today. Ingredients-only is a defensible v1 for a
   grocery-centric app, but decide deliberately. **Recommend: add sourceUrl + discovery fields
   now; punt instructions to a fast-follow.**
5. **Slots: dinner-only v1 or breakfast/lunch/dinner?** **Recommend dinner-first with optional
   slots.**
6. **Catalog recipe on add: clone or reference?** **Recommend clone-on-add** — user edits
   don't mutate the shared catalog, and the recipe survives catalog changes.
7. **Week start day** (Sun vs Mon) — affects Home strip + Plan grid. Needs a persona call.

---

## 6. Roadmap {#roadmap}

Phased so each step ships value and de-risks the next. **Phase 0 unblocks everything.**

### Phase 0 — Structure (do first)
Split the monolithic `index.tsx` into the 5 file-based routes; add the responsive nav shell
(`sidebar ≥1024px` ↔ `bottom tab bar <640px`) in `__root.tsx`; a simple **state-aware Home**
(week strip + single next-action CTA + shopping-day card); settings behind a profile menu;
basic empty states; Pantry as a thin placeholder tab. Existing components move almost as-is.
*No new dependencies.*

### Phase 1 — Core loop MVP
- **Planner:** basket + `day`/`slot`/`servingsMultiplier`; dinner-first week (grid desktop /
  agenda mobile); tap add/move; non-destructive **diff-merge** "Generate list."
- **List polish:** aisle sections; tap-to-check + move-to-cart; recipe provenance; one-handed
  bottom controls; "Done shopping" flow.
- **Recipe funnel:** unify manual + catalog + review into one screen; catalog search + filter
  chips (time/diet/cuisine); **basic URL import** via JSON-LD + paste-text fallback.

### Phase 2 — Pantry thin loop (the differentiator)
Auto-add from grocery check-off (inflow); **don't-rebuy** diff on list generation;
cook-decrement (outflow, needs planner "mark cooked"); category-default expiry + batched,
actionable nudges; a simple use-soon pantry view.

### Phase 3 — Vision layer
Drag-and-drop planner + week templates ("copy last week," "Taco Tuesday"); **offline PWA** for
in-store; store-specific aisle ordering; shared-household roles + live co-shopping presence;
recommendations / "For You" plans (BL-0005); photo/receipt/barcode import + AI cleanup; waste
analytics.

### First guided experience (onboarding, threads through Phase 0–1)
Guided-plan-first (Mealime model), not a blank canvas: 1-screen prefs (skippable) → "pick 3
recipes" from the filtered catalog (solves cold-start) → a lightly pre-filled `/plan` →
one-tap "Build your grocery list" = **first value in one session.** A dismissible Home
checklist gives direction and disappears when complete.

---

## 7. Risks

- **Pantry outflow accuracy** is make-or-break: without reliable cook-decrement, inventory
  drifts and every downstream pantry feature degrades into wrong-answer noise. The planner's
  "mark cooked" event gates it.
- **List regeneration** done wrong recreates the "rebuild the week" resentment competitors are
  abandoned for.
- **In-store offline** is the one place web is structurally weaker than native.
- **Aggregation correctness** (dedup, unit merge) is the make-or-break backend dependency for
  the Plan→List promise; if the list looks wrong, the core value breaks.
- **Scope creep vs the persona:** price intelligence, store maps, integrations, full pantry
  tracking are attractive but the weekly-family-shop persona is ~80% served by Phases 0–1.
  Ship the loop first.

---

## Appendix — research provenance

Five parallel research briefs (2026-07-12) informed this plan: meal planning, recipe
import/discovery, smart grocery list, pantry/waste, and information architecture. Competitive
references included Plan to Eat, Mealime, Paprika, AnyList, Samsung Food, NYT Cooking, Cozi,
Bring!, Our Groceries, Instacart, and pantry apps (NoWaste, Kitche, KitchenPal, Recipy). The
full briefs with citations are available on request / in the PR thread.
