---
id: BL-0063
title: Native recipes browse (list, catalog, kitchen, filters, add funnel)
status: done
area: mobile
effort: L
related_specs: [2026-08-16-mobile-client-parity-design.md]
created: 2026-08-16
---

## Context

Three routes — `/recipes`, `/recipes/catalog`, `/recipes/kitchen` — plus the
add funnel and edit flows built by BL-0013 and BL-0020, and the catalog filters
and discovery metadata from BL-0030.

The largest single view-porting item in the parity phase, because it is really
several screens sharing a data layer.

## Proposal

Port the recipe list, the seeded catalog with search and filters, My Kitchen and
its unlocks, the one-screen add/review funnel, and recipe create/edit forms.

Forms are the awkward part. The web edit dialog still uses
`<dialog>.showModal()`, which has no native equivalent and is untested on the
web for the same reason — so the native port needs its own presentation, and
this is a good moment to give the web version an explicit overlay too, the way
BL-0026 did for the confirm dialog.

URL import stays server-side and unchanged; the native client gets the same
review screen over the same action.

## Alternatives considered

- **Split into three items, one per route.** Tempting for parallelism, but they
  share the add funnel, the recipe card, and the draft state
  (`useRecipeDraft`), so splitting mostly manufactures merge conflicts.
- **Skip recipe authoring on mobile, browse only.** A real option — typing a
  recipe on a phone is unpleasant — but URL import on a phone is *more* natural
  than on a desktop, since that is where links are shared.

## Progress

**Done.** All three views, the add funnel and the edit form are native, and the
logic behind them is shared.

**One tab, three views.** Web's `/recipes`, `/recipes/catalog` and
`/recipes/kitchen` are a sub-nav under a route; here they are a segmented
control that switches in place. A phone has no room for a second row of
navigation under a tab bar, and the three are peers over one subject rather
than destinations — so switching back to My recipes is not a back gesture
through the catalog. The add funnel and the edit form ARE pushed
(`/recipes/new`, `/recipe/[id]/edit`), because those you enter and finish.

**What moved into `@pantry/core`**, following the parity plan's §4 loop — port a
route, push its wiring down, have web adopt the same hook:

- `catalogFilter.ts` — the search predicate, the chip vocabularies derived from
  the loaded catalog, and the AND-across-groups / OR-within rule. "What does
  vegan + under 30 min show?" is a fact about the data, not about a chip row.
- `equipmentFit.ts` — sectioning, the fit copy and the hidden-count summary,
  out of `apps/web/src/lib`. `FIT_LABELS` carries the words; each client maps a
  status to its own colours, which is all `apps/web/src/lib/equipmentFit.ts`
  still holds.
- `servings.ts`, `useHouseholdSize`, `useEquipmentCatalog` — also out of
  `apps/web/src/lib`, now that a second editor and a second catalog need them.
- `draftFromRecipe()` — editing is the same review surface with a different
  starting point, so it seeds the same `RecipeDraft`.
- Screen hooks: `useMyRecipes`, `useCatalog`, `useMyKitchen`,
  `useKitchenUnlocks`, `useRecipeEditor`. Each takes the injectable action
  wrappers `useRecipeDetail` established, so web keeps its traced actions.

`Catalog`, `RecipeList`, `MyKitchen` and `KitchenUnlocks` on web are now
presentation over those hooks; all 491 web tests passed unchanged, which is the
evidence that the push-down preserved behaviour rather than re-specified it.

**The forms.** The awkwardness the proposal flagged resolved differently than it
guessed. The native editor needed no equivalent of `<dialog>.showModal()`,
because on a phone the edit form is a *screen* — there is nothing for an overlay
to overlay. So the web `<dialog>` is untouched and the "give the web version an
explicit overlay too" suggestion is **not done**; it is a web-only change with a
web-only justification and belongs in its own item. What did get shared is the
part that would actually have drifted: the draft, the field set, and the save.

Native-only shapes, and why:

- One review surface, `recipeId` optional, rather than a create screen and an
  edit screen. The moment they are two, one quietly stops rendering a field and
  starts dropping it on save — which is the failure BL-0020 was written about.
- The prep window is a cycling button, not a picker: React Native has no picker
  in core, and six values in a fixed order cycle in fewer taps than a modal
  wheel costs to open.
- Equipment is a chip per catalog entry cycling required → optional → gone,
  rather than web's `<select>` plus a toggle. Same information, no picker inside
  a form inside a scroll view.
- Deleting a recipe asks inline rather than opening a dialog, matching what the
  native pantry already does with its rows.

**URL import stays server-side and unchanged**, as proposed. The native client
gets the same review screen over the same action — and importing on a phone is
the case that earns the whole screen, since a link is usually shared there.

`useRecipeDetail` / `useRecipePrep` gained an `enabled` flag so a create-mode
editor makes no requests; the rules of hooks mean the call cannot simply be
skipped.

Verified: `pnpm check` green — core (700 tests), web (491), Convex, mobile
(340 across 36 suites), typecheck, type-aware lint, knip, contract freshness.

Not in scope and still open: the "For you" discovery panel web renders above
this list (BL-0005's surface, and on native it has a home on the home screen
already), and photo import, which BL-0020 deferred.
