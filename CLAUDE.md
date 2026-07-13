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
   make a dedicated commit that only flips the item to `in-progress`:
   - set `status: in-progress` in the item file's frontmatter, and
   - update the item's `Status` cell to `in-progress` in the
     `docs/backlog/README.md` index table.

   Nothing else goes in this commit. Message it like
   `chore(backlog): claim BL-NNNN`. Push it (open its PR) **before** you start
   building, so other agents see the item is taken.
2. **Then begin.** Do the actual implementation in subsequent, separate
   changesets.
3. **Before claiming, check it isn't already taken.** If the item is already
   `in-progress` (in the file, the index, or an open branch/PR named for it),
   don't pick it up — choose another or coordinate.
4. **On completion**, set `status: done` (and link any produced spec into
   `related_specs`) as part of the finishing changeset.

The point is the *separate changeset*: the claim is a small, fast, standalone
signal that reaches other agents before your longer implementation work does.

## Open pull requests for review, not as drafts

When you open a PR — whether the claim changeset or the implementation work —
publish it as a normal, ready-for-review PR. **Do not open it as a draft.** The
PR is meant to be reviewed, so it should be visible for review the moment it is
opened.
