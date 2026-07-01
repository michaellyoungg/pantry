---
id: BL-0009
title: recipe-service HTTP hardening (timeouts, body cap, graceful shutdown)
status: done
area: infra
effort: S
related_specs: [2026-06-29-recipe-to-grocery-list-design.md]
created: 2026-06-29
---

## Context

Surfaced in the Plan 1 final review. The recipe-service uses
`http.ListenAndServe` directly with no server timeouts, decodes request bodies
with no size cap, and `main`'s `defer pg.Close()` never runs (the process exits
via `log.Fatal`/`os.Exit`, which skips defers). All acceptable for the M1
skeleton, but cheap prod-readiness worth doing before real deployment.

## Proposal

- Replace `http.ListenAndServe` with an `http.Server{}` literal setting
  `ReadHeaderTimeout`, `ReadTimeout`, `WriteTimeout`, `IdleTimeout`.
- Wrap request-body decoding with `http.MaxBytesReader` (bound payload size).
- Add graceful shutdown: catch `SIGINT`/`SIGTERM`, `server.Shutdown(ctx)`, then
  `pg.Close()` — making the pool cleanup actually run.

## Alternatives considered

- Leave as-is — fine for local dev, but slowloris / unbounded-body exposure and
  a cosmetically-dead `defer` are easy to remove now and avoid a later churn of
  `main`.
