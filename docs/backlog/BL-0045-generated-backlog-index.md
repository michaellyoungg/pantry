---
id: BL-0045
title: Generate the backlog index from item frontmatter (kill the merge-conflict hotspot)
status: done
area: infra
effort: S
related_specs: []
created: 2026-08-03
---

## Context

`docs/backlog/README.md` carries a hand-maintained index table with one row per
backlog item. Claiming an item, finishing one, or filing a new one all mean
editing that one table — so with several agents landing PRs concurrently,
**every merge re-conflicts every other open PR on that file.** Measured on the
current queue: after a handful of merges, the only remaining conflict across all
open PRs was this file, and it has cost multiple agents a full rebase cycle
each.

The conflict is pure bookkeeping. The status of an item is already recorded
authoritatively in that item's own frontmatter (`status:`); the table is a
derived view that happens to be maintained by hand, which is what puts every
agent on the same lines of the same file.

## Proposal

- **Generate the index.** A script (`scripts/backlog-index.mjs`) reads `id`,
  `title`, `status`, `area`, `effort` from each `docs/backlog/BL-NNNN-*.md`
  frontmatter and rewrites **only** the table under the `## Index` heading in
  `docs/backlog/README.md`, sorted by id. Everything above `## Index` is
  hand-written prose about conventions and is preserved byte-for-byte.
- **Check it in CI.** `--check` regenerates in-memory and fails if the committed
  README differs, wired into the Node job alongside Biome/typecheck/test so a
  stale index can't land.
- **Retire the hand-edit rule.** `CLAUDE.md` and the conventions section of
  `docs/backlog/README.md` document the claim step as *only* setting
  `status: in-progress` in the item file's frontmatter (and `status: done` on
  completion). Two agents claiming different items then never touch the same
  line — they touch different files.

## Alternatives considered

- **Drop the index table entirely** — the directory listing is already the
  source of truth. Rejected: the table is genuinely useful for humans scanning
  status/area/effort at a glance, and generating it costs one small script.
- **Keep the table by hand but ask agents to be careful** — this is the status
  quo, and it is what is failing; care doesn't help when two correct edits touch
  adjacent lines.
- **Sort by status or area** — nicer to read, but any status change would then
  move rows and re-introduce conflicts. Sorting by id keeps a claim to a
  one-cell diff on a stable line.
