# Pantry — agent guide

A hybrid multi-service monorepo (React web, Go recipe-service, self-hosted
Convex). See `README.md` for architecture, `docs/ci-and-quality.md` for the
checks every PR must pass, and `docs/backlog/` for planned work.

## Claim a work item before you build it

This repo is worked by many agents in parallel. To avoid two agents picking up
the same backlog item, **claiming is a separate changeset that lands before any
implementation work.**

When you pick up a backlog item (`docs/backlog/BL-NNNN-*.md`):

1. **Claim it first, in its own changeset.** Before writing any implementation,
   make a dedicated commit that only sets `status: in-progress` in the item
   file's frontmatter. **Do not hand-edit the index table** in
   `docs/backlog/README.md` — it is generated from the item files (see below).

   Nothing else goes in this commit. Message it like
   `chore(backlog): claim BL-NNNN`. Push it (open its PR) **before** you start
   building, so other agents see the item is taken.
2. **Then begin.** Do the actual implementation in subsequent, separate
   changesets.
3. **Before claiming, check it isn't already taken.** If the item is already
   `in-progress` (in the file, the index, or an open branch/PR named for it),
   don't pick it up — choose another or coordinate.
4. **On completion**, set `status: done` in the item file's frontmatter (and
   link any produced spec into `related_specs`) as part of the finishing
   changeset.

## The backlog index is generated — never hand-edit it

The `## Index` table in `docs/backlog/README.md` is derived from the `id`,
`title`, `status`, `area` and `effort` frontmatter of every
`docs/backlog/BL-NNNN-*.md`. Editing an item's frontmatter is the *only* thing
you do; regenerate the table with:

```bash
pnpm backlog:index          # rewrite the table
pnpm backlog:index:check    # what CI runs — fails if the table is stale
```

This exists because a hand-maintained table put every parallel agent on the same
lines of the same file, so every merge re-conflicted every other open PR. Two
agents claiming different items now touch different files. Everything above the
`## Index` heading is hand-written prose and is preserved untouched.

The point is the *separate changeset*: the claim is a small, fast, standalone
signal that reaches other agents before your longer implementation work does.

## Open pull requests for review, not as drafts

When you open a PR — whether the claim changeset or the implementation work —
publish it as a normal, ready-for-review PR. **Do not open it as a draft.** The
PR is meant to be reviewed, so it should be visible for review the moment it is
opened.
