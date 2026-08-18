---
id: BL-0063
title: Native recipes browse (list, catalog, kitchen, filters, add funnel)
status: in-progress
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
