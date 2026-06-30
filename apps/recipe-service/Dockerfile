# syntax=docker/dockerfile:1
FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /out/recipe-service ./cmd/server

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/recipe-service /recipe-service
EXPOSE 8090
USER nonroot:nonroot
ENTRYPOINT ["/recipe-service"]
