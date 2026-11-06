# syntax=docker/dockerfile:1
FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /out/recipe-service ./cmd/server
RUN CGO_ENABLED=0 go build -o /out/seed ./cmd/seed

FROM gcr.io/distroless/static-debian12:nonroot AS seed
COPY --from=build /out/seed /seed
USER nonroot:nonroot
ENTRYPOINT ["/seed"]

FROM gcr.io/distroless/static-debian12:nonroot AS server
COPY --from=build /out/recipe-service /recipe-service
# The seed binary ships in the server image too, so a platform that cannot
# select a build stage can still run the catalog seed by overriding the start
# command. Railway is such a platform: its service config exposes
# `dockerfilePath` and `startCommand` but no Docker build target, so the `seed`
# stage above is unreachable there and the catalog would stay empty forever.
# Compose still builds that stage directly (`target: seed`).
COPY --from=build /out/seed /seed
EXPOSE 8090
USER nonroot:nonroot
ENTRYPOINT ["/recipe-service"]
