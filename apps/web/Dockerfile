# syntax=docker/dockerfile:1
#
# Production image for the web app (BL-0006).
#
# BUILD CONTEXT IS THE REPO ROOT, not apps/web:
#   docker build -f apps/web/Dockerfile --build-arg VITE_CONVEX_URL=... .
#
# @pantry/web imports @pantry/core, @pantry/types, @pantry/design-tokens and
# @pantry/convex through their built dist/. Building from apps/web alone
# resolves nothing and fails at the first import.
FROM node:22-alpine AS build
WORKDIR /src
RUN corepack enable

# Manifests first, so a source-only change reuses the install layer.
#
# EVERY workspace manifest has to be here, including ones this image never
# builds: pnpm resolves the globs in pnpm-workspace.yaml against the lockfile's
# importers, so a missing apps/mobile/package.json fails --frozen-lockfile
# outright rather than being quietly skipped.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/mobile/package.json apps/mobile/
COPY apps/recipe-service/package.json apps/recipe-service/
COPY apps/web/package.json apps/web/
COPY packages/convex/package.json packages/convex/
COPY packages/core/package.json packages/core/
COPY packages/design-tokens/package.json packages/design-tokens/
COPY packages/types/package.json packages/types/

# `pantry` is the root project, which owns turbo and typescript — the filter has
# to name it or `pnpm build` has no turbo to run. `@pantry/web...` is web plus
# its dependencies, which deliberately excludes @pantry/mobile: its Expo and
# React Native trees are hundreds of megabytes this image would download, build
# with, and never serve.
RUN pnpm install --frozen-lockfile --filter=pantry --filter=@pantry/web...

COPY . .

# Vite inlines VITE_* at build time, so the Convex URL is baked into the
# bundle here. Changing it later means rebuilding this image.
ARG VITE_CONVEX_URL
ENV VITE_CONVEX_URL=$VITE_CONVEX_URL

# `@pantry/web...` is web AND its dependencies. The Go recipe-service is not a
# dependency of web, so its build task never runs and no Go toolchain is needed.
RUN pnpm build --filter=@pantry/web...

FROM caddy:2-alpine AS serve
COPY apps/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /src/apps/web/dist /srv
EXPOSE 8080
