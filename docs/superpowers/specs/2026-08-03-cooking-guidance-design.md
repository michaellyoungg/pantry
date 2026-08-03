# Cooking guidance — steps, equipment, and derived prep tasks

**Status:** approved · **Backlog items:** [BL-0022](../../backlog/BL-0022-persist-recipe-steps.md)
(prerequisite), [BL-0041](../../backlog/BL-0041-equipment-catalog-recipe-tagging.md),
[BL-0042](../../backlog/BL-0042-prep-rule-engine.md),
[BL-0043](../../backlog/BL-0043-equipment-inventory-discovery.md),
[BL-0044](../../backlog/BL-0044-prep-sources-llm-manual.md)
· **Related:** [full-app UX plan](2026-07-12-full-app-ux-plan.md),
[URL import + recipe parser](2026-07-12-url-import-recipe-parser-design.md),
[mobile client](2026-07-18-mobile-client-design.md)

This is an umbrella design. It defines one mechanic end to end; each backlog item it
names gets its own implementation plan.

## Goal

Pantry can tell you *what* to buy but not *how* to cook. A recipe is an ingredient
list with no method, no notion of what hardware it needs, and no notion that some
work has to happen a day early. This design adds three layers:

1. **Steps** — the method, which the importer already extracts and discards.
2. **Equipment** — modeled as real entities, not strings, so the app can answer
   "can I make this?" and "I just got a sous-vide, what can I cook?"
3. **Prep tasks** — work derived from the recipe rather than authored on it:
   thaw the chicken, soften the butter, preheat the oven, light the smoker.

Layer 3 is the point. A step that says "preheat the oven" is recipe content, but the
*fact* that baking implies preheating is knowledge about baking, not about this
recipe. Deriving it means it applies to every recipe already in the database and
improves for all of them at once — and it is what makes a future "pull the chicken
out of the freezer" notification possible without anyone hand-authoring it.

## Prerequisite: BL-0022 is written but never landed

BL-0022 ("persist recipe steps end to end") was fully implemented — Go store and
schema, `packages/types`, Convex actions, and web UI (`StepsEditor.tsx`, steps in
`RecipeDetails`, import wiring; ~450 lines across 24 files). PR #40 is marked merged,
but its merge commit is the *claim* commit; the implementation was pushed to the
branch after the squash-merge and stranded there.

The work sits on `origin/worktree-myoung-bl-0022-recipe-steps` at commits `4526de1`
(recipe-service) and `0c29db6` (web). As of `origin/main` `4274120`, `Steps` appears
zero times in `apps/recipe-service/internal/recipe/types.go`.

**Recovering that branch onto main is a prerequisite for everything below.** Nothing
in this design re-litigates its choices; it builds on them.

## Constraints

- **Recipe bodies do not live in Convex.** Ingredients, steps, equipment, methods,
  and the rule data all live in the Go recipe-service (Postgres). Convex holds user
  state: the week plan (`basket`), the grocery list, preferences. This design keeps
  that line exactly where BL-0022 drew it.
- **Day granularity, no clock times.** The planner assigns a meal to a weekday, not
  a time. Prep windows are relative to the cook *date*; the design introduces no
  "when do you eat dinner" setting.
- **No LLM dependency in the first slice.** There is no API key configured, so the
  import LLM fallback is off. Everything in BL-0041 and BL-0042 must work
  deterministically without it.
- **Ingredient canonicalization already exists.** `Normalizer.CanonicalItem` (BL-0003,
  extended by BL-0021) is the join key the rule engine uses, so ingredient-driven
  rules need no new per-recipe tagging pass.
- **…but the dictionary is nearly empty.** `normalization.json` currently holds
  **5 items** across 3 aisles (`produce`, `pantry`, `dairy`) — no meat or poultry at
  all. Ingredient rules are mechanically free for every existing recipe, but their
  *reach* is bounded by that dictionary: a "thaw the chicken" rule matches nothing
  until "chicken" is in it. [BL-0031](../../backlog/BL-0031-normalization-dictionary-coverage.md)
  (normalization dictionary coverage) is therefore a soft dependency for BL-0042 —
  not a blocker for building the engine, but a blocker for the engine being useful.
  Method- and equipment-driven rules have no such limit.

## Data model

### recipe-service (Postgres)

```sql
-- From the stranded BL-0022 branch, unchanged.
CREATE TABLE recipe_steps (
    id          BIGSERIAL PRIMARY KEY,
    recipe_id   TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    position    INT  NOT NULL,
    text        TEXT NOT NULL
);

-- Curated equipment catalog. Reference data, not user data.
CREATE TABLE equipment (
    id          TEXT PRIMARY KEY,       -- slug: "sous_vide_circulator"
    name        TEXT NOT NULL,          -- "Sous-vide circulator"
    category    TEXT NOT NULL,          -- appliance | cookware | tool
    aliases     TEXT[] NOT NULL DEFAULT '{}'
);

CREATE TABLE recipe_equipment (
    recipe_id    TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    equipment_id TEXT NOT NULL REFERENCES equipment(id),
    required     BOOLEAN NOT NULL DEFAULT TRUE,
    PRIMARY KEY (recipe_id, equipment_id)
);

CREATE TABLE recipe_methods (
    recipe_id   TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    method      TEXT NOT NULL,
    PRIMARY KEY (recipe_id, method)
);

-- Materialized prep tasks: LLM-derived and hand-authored only.
-- Empty until BL-0044; the table exists so those sources need no migration.
CREATE TABLE recipe_prep_tasks (
    id           BIGSERIAL PRIMARY KEY,
    recipe_id    TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    position     INT  NOT NULL,
    prep_window  TEXT NOT NULL,         -- NOT `window`: reserved word in Postgres
    text         TEXT NOT NULL,
    source       TEXT NOT NULL          -- "llm" | "manual"
);
```

`prep_window`, not `window` — `WINDOW` is a reserved keyword and
`CREATE TABLE t (window TEXT)` is a syntax error (verified against the local
Postgres). The JSON/Go field stays `window`; only the column is renamed.

`required = false` keeps "you could use a grill pan instead" expressible, and keeps
optional equipment from blocking the "can I make this?" check in BL-0043.

**Methods** are a closed enum: `bake`, `roast`, `grill`, `smoke`, `sous_vide`,
`slow_cook`, `pressure_cook`, `fry`, `saute`, `boil`, `marinate`, `no_cook`. Closed
because rules key on them; an open vocabulary makes rules unwritable.

### Prep rules — a data file, not a table

Rules are curated reference data that ships with the service and is versioned in git,
loaded at boot exactly like the normalizer's data file (`mustLoadNormalizer`). They
are not user-editable and not per-recipe, so a table buys nothing and costs a
migration on every rule edit.

```yaml
rules:
  - id: thaw_frozen_protein
    when: { ingredient_state: frozen, category: protein }
    window: night_before
    text: "Move the {item} to the fridge to thaw"
    priority: 100

  - id: thaw_frozen_large_roast
    when: { ingredient_state: frozen, category: protein, min_quantity_lb: 8 }
    window: three_days_before
    text: "Move the {item} to the fridge — a large frozen roast needs days, not hours"
    priority: 200          # higher priority wins over thaw_frozen_protein

  - id: soften_butter
    when: { canonical_item: butter, ingredient_state: softened }
    window: hour_before
    text: "Set the butter out to soften"
    priority: 100

  - id: preheat_oven
    when: { method: bake }
    window: at_start
    text: "Preheat the oven"
    priority: 100

  - id: light_smoker
    when: { equipment: smoker }
    window: hour_before
    text: "Light the smoker and bring it up to temperature"
    priority: 100
```

A rule matches on exactly one of `canonical_item` / `category`, `method`, or
`equipment`, plus optional qualifiers (`ingredient_state`, `min_quantity_lb`). When
two rules produce the same subject, the higher `priority` wins and the loser is
dropped — that is how the large-roast rule supersedes the generic thaw rather than
emitting both.

**`category` does not exist yet.** `normalization.json` gives each item a `display`
and an `aisle` only, and `aisle` is the wrong axis — a rule wants "this is a
protein", not "this is in the meat aisle". Adding an optional `category` to each
item in that dataset is part of BL-0042, and it is a small change to a file that
BL-0042 is already extending.

### Windows

Relative to the cook date, coarsest first:

| Window | Meaning |
|---|---|
| `three_days_before` | large frozen items |
| `two_days_before` | brining, long marinades, dried beans |
| `night_before` | ordinary thawing, overnight marinade, proofing |
| `morning_of` | slow cooker start, long braises |
| `hour_before` | softening butter, tempering, lighting a smoker |
| `at_start` | preheating, boiling water |

A frozen turkey and a frozen chicken breast both thaw, but they do not belong in the
same bucket — the enum spans multiple days for that reason.

### Convex (user state)

```ts
// What the user owns. Slugs reference recipe-service's equipment catalog.
equipmentInventory: defineTable({
  userId: v.string(),
  equipmentId: v.string(),
}).index("by_user", ["userId"]),

// Prep task check-off. Mirrors groceryList.checked.
prepTaskState: defineTable({
  userId: v.string(),
  taskKey: v.string(),   // stable across re-derivation
  cookDate: v.string(),  // ISO date of the meal this prep is for
  done: v.boolean(),
}).index("by_user", ["userId"])
  .index("by_user_task", ["userId", "taskKey", "cookDate"]),
```

Inventory lives in Convex, not recipe-service, because it is reactive user state like
`basket` and `groceryList` — and because the reverse query ("what can I cook with
this?") then follows the aggregation pattern that already exists: Convex sends the
owned slugs to recipe-service, recipe-service does the matching against recipe data
it already holds.

## The derivation engine

The heart of the design is one pure function in Go:

```go
func DerivePrepTasks(r Recipe, cookDate time.Time) []PrepTask
```

No I/O, no database, no clock — fully unit-testable, and the natural home for the
rule table it reads.

```go
type PrepTask struct {
    Key    string `json:"key"`    // stable: ruleID + ":" + subject
    Window string `json:"window"`
    Text   string `json:"text"`
    Source string `json:"source"` // "rule" | "llm" | "manual"
    DueOn  string `json:"dueOn"`  // ISO date = cookDate - window offset
}
```

**Matching.**

- *Ingredient rules* key on `Normalizer.CanonicalItem(ing.Item)` for the subject and
  on state words parsed out of the ingredient's `Note` and item text — `frozen`,
  `softened`, `room temperature`, `dried`, `thawed`. This is why ingredient rules
  need no new tagging: every recipe already in the database gets them for free the
  moment the rule ships.
- *Method rules* key on `recipe_methods`; *equipment rules* on `recipe_equipment`.

**Stable keys.** `Key` is `ruleID + ":" + subject` (subject = canonical item, method,
or equipment slug). It is deterministic, so check-off survives re-derivation, recipe
edits that do not touch the subject, and service restarts. Editing a rule's *text*
preserves state; changing a rule's *id* deliberately does not — a renamed rule is a
new task and reappears unchecked. That tradeoff is chosen consciously: silently
carrying state across a redefinition is worse than one reappearing checkbox.

**Merging the three sources.** `DerivePrepTasks` emits rule-derived tasks; stored
`recipe_prep_tasks` rows supply `llm` and `manual` ones. They merge into one list
deduped by `Key`, precedence **manual > llm > rule**. That is how the user's answer
of "I want 1, 2 and 3" coexists rather than competing: three producers, one stream,
one precedence order. A hand-authored task overrides the rule that would have
produced it instead of doubling it.

**Endpoint.**

```
POST /prep-tasks
  { "meals": [ { "recipeId": "...", "cookDate": "2026-08-05" } ] }
→ { "meals": [ { "recipeId": "...", "cookDate": "...", "tasks": [PrepTask] } ] }
```

Same call shape as the existing grocery-list aggregation, so Convex reaches it
through an action the same way and the auth/secret plumbing is unchanged.

## Tagging at import

Equipment and methods have to come from somewhere for imported recipes.

1. **JSON-LD.** `recipeInstructions` is already extracted (`import_jsonld.go`) and
   discarded; BL-0022 wires it to steps. `cookingMethod`, when present, maps onto
   the method enum. (`recipeCategory` and `keywords` are *not* read here — they
   belong to BL-0030's tags; see "Overlap with concurrent work".)
2. **Keyword scan over step text.** Deterministic, driven by the same `aliases`
   column as the equipment catalog: "crock pot" / "slow cooker" → `slow_cooker` +
   `slow_cook`; "immersion circulator" / "sous vide" → `sous_vide_circulator` +
   `sous_vide`; "preheat the oven" → `oven` + `bake`; "panini press", "air fryer",
   "smoker", "grill" likewise. One alias table serves both detection and display.
3. **LLM fallback (BL-0044).** Fills equipment and methods only when the scan finds
   nothing. Its job is to *tag*, not to invent prep advice — prep text stays the rule
   table's responsibility so it remains explainable and improvable.
4. **The user.** The recipe edit form exposes equipment and methods, so a wrong guess
   is one correction away.

## Surfaces

The first shippable slice is prep scheduling, not an in-kitchen mode.

- **Home** — a "Before you cook" card listing this week's derived tasks due today,
  with check-off. Home is already state-aware from BL-0017; this is one more state,
  and it slots in ahead of the plan/shop states when something is due.
- **Recipe detail** — steps (from BL-0022), required equipment, and a "before you
  start" list showing the recipe's prep tasks with their windows.
- **Planner** — a badge on a `MealCard` that carries lead-time prep. The point is to
  see the 24-hour thaw *when you schedule the meal*, not the night you forgot it.
- **My Kitchen** — check off owned equipment; the catalog gains an "I can make this"
  filter and a "new to your kitchen" view when equipment is added. That is the
  sous-vide question, and it is a read over data the earlier items already collect.

A live step-by-step cook mode with persisted progress is explicitly **not** in this
design. It is the natural next surface once steps and equipment exist, and it is
where timers would belong, but nothing here depends on it.

## Notifications — modeled, not built

Every derived task resolves to a concrete `DueOn` date. When the mobile client
exists ([mobile client design](2026-07-18-mobile-client-design.md)), a scheduled job
turns tasks due today into pushes, and a morning "pull the chicken out of the
freezer" nudge is a query over data this design already produces. Nothing in the
first slice depends on notification infrastructure, and nothing in it blocks that
infrastructure later.

## Testing

- `DerivePrepTasks` is a pure function: table-driven Go tests over
  (recipe, cookDate) → expected tasks, covering priority supersession, dedupe by key,
  and source precedence. This is where the bulk of the coverage belongs.
- Key stability: a golden test asserting that a rule text edit preserves keys.
- Import tagging: fixture HTML per detection path (JSON-LD `cookingMethod`, keyword
  scan, neither) asserting the resulting equipment and method sets.
- Convex integration tests for `prepTaskState` check-off and `equipmentInventory`,
  following `recipes.integration.test.ts`.
- One Playwright pass: schedule a meal with a frozen protein, assert the thaw task
  appears on Home, check it off, assert it stays checked. Use the `navigateTo()` nav
  helper — `page.goto()` cancels in-flight Convex mutations.

## Decomposition

| Item | Scope |
|---|---|
| **BL-0022** (exists, stranded) | Recover the steps branch onto main. Prerequisite. |
| **BL-0041** | Equipment catalog, recipe equipment/method tagging, import detection |
| **BL-0042** | Prep rule engine, `POST /prep-tasks`, Home "Before you cook", check-off |
| **BL-0043** | Equipment inventory, "I can make this", new-device discovery |
| **BL-0044** | LLM-derived and hand-authored prep sources |

BL-0041 and BL-0042 are the first slice. BL-0043 is a read over data they collect.
BL-0044 needs an LLM API key that is not currently configured.

### Overlap with concurrent work

BL-0030, BL-0031 and BL-0035 are filed on branches that have not merged yet
(PR #72 and the BL-0005 recommendations work), so links to them resolve only once
those land. Their IDs are already allocated and are not reused here.

[BL-0030](../../backlog/BL-0030-recipe-discovery-metadata.md) (cuisine, tags, cook
time, source URL) extends the recipe model along a different axis at the same time.
The two are complementary, not competing — BL-0030 adds *what kind of dish this is*,
this design adds *what it takes to cook it* — but they touch the same files
(`types.go`, `schema.sql`, `packages/types`, the recipe form) and both wire new
fields out of JSON-LD import. Whoever lands second rebases. To keep the import
split clean: **BL-0030 owns `recipeCategory` and `keywords`** (→ tags);
**this design owns `cookingMethod`** (→ methods). Neither should claim both.

[BL-0035](../../backlog/BL-0035-recipe-yield-servings.md) (recipe yield/servings) is
independent — no rule in this design keys on servings — but the large-roast rule's
`min_quantity_lb` qualifier reads ingredient quantities, which BL-0035 may normalize.

## Alternatives considered

- **Prep tasks as ordinary recipe fields the user fills in.** No engine at all, and
  simplest possible model — rejected because it puts the work on the user for every
  recipe and never reaches the notification experience. It survives as *one of three*
  sources (`manual`) rather than as the whole mechanic.
- **LLM derives prep tasks at import and we store them.** No rule table to maintain
  and it handles anything — rejected as the *primary* source because it is
  non-deterministic, cannot be improved retroactively without re-importing every
  recipe, and needs a key that is not configured. Kept as source `llm` in BL-0044.
- **Free-text equipment strings on the recipe.** Cheapest, but strings cannot be
  matched against an inventory, so the discovery experience would need a migration
  later. Rejected in favor of modeling equipment properly up front.
- **Clock times on planned meals** (a "dinner is at 6:30" setting, or asking at plan
  time). More precise scheduling, but it adds a setting or planner friction that
  BL-0018 deliberately avoided. Relative windows anchored to the cook date carry the
  first slice, and upgrading to timestamps later is additive.
- **Deriving prep in Convex instead of Go.** Rejected: Convex holds no recipe bodies,
  so it would have to fetch ingredients over an action just to run rules over them,
  and Convex queries cannot do network I/O.
