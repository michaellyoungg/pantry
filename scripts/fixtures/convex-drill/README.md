# Convex drill fixtures

Known data used by `scripts/convex-restore-drill.sh` and
`scripts/convex-upgrade-rehearsal.sh` (BL-0008). One file per table; each is a
JSON array shaped for `convex import --table <name> --format jsonArray`, so the
documents must satisfy the validators in `packages/convex/convex/schema.ts`.

They deliberately cover the awkward cases a naive round-trip can lose: an
optional field that is present on some rows and absent on others
(`alreadyHave`), a boolean that is `true` rather than the default `false`, and
both members of a union (`state`, `source`). If you add a field to one of these
tables, add a row here that exercises it.

These are scratch-stack fixtures only — nothing imports them into a real
deployment.
