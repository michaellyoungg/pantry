# @pantry/web

The Pantry web app — a React + Vite frontend for managing grocery lists, baskets, and recipes.

## Prerequisites

- Compose stack running (`docker compose up -d` from repo root)
- `.env.local` with at minimum:
  ```
  VITE_CONVEX_URL=<your-convex-deployment-url>
  VITE_RECIPE_SERVICE_URL=http://localhost:3001
  ```

## Dev

```bash
pnpm --filter @pantry/web dev
```

## Build

```bash
pnpm --filter @pantry/web build
```

## Notes

- Talks to Convex (real-time DB + serverless functions) via `@pantry/convex`.
- Talks to the recipe service over HTTP via `VITE_RECIPE_SERVICE_URL`.
