#!/usr/bin/env bash
# Verify the production web image (BL-0006 increment 1).
#
#   bash scripts/smoke-web-image.sh
#
# Builds the image and asserts the three behaviours that a naive static server
# gets wrong: the app renders at /, deep links fall back to index.html, and a
# MISSING ASSET still 404s rather than being handed the HTML fallback.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

IMAGE=pantry-web-smoke
# 8099 belongs to the integration suite; a stale listener there silently
# replaces the thing under test.
HOST_PORT=8123

echo "==> building $IMAGE"
docker build -f apps/web/Dockerfile \
  --build-arg VITE_CONVEX_URL=http://127.0.0.1:3210 \
  -t "$IMAGE" .

CID="$(docker run -d -e PORT=8080 -p "$HOST_PORT:8080" "$IMAGE")"
cleanup() { docker rm -f "$CID" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "==> waiting for the server"
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$HOST_PORT/" >/dev/null 2>&1; then break; fi
  sleep 1
done

fail() {
  echo "FAIL: $*" >&2
  docker logs "$CID" >&2 2>&1 || true
  exit 1
}

echo "==> / serves the app shell"
curl -fsS "http://127.0.0.1:$HOST_PORT/" | grep -q 'id="root"' ||
  fail "/ did not serve the app shell"

echo "==> deep links fall back to index.html"
for route in /plan /list /recipes/catalog; do
  code="$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:$HOST_PORT$route")"
  [ "$code" = "200" ] || fail "$route returned $code, expected 200"
  curl -fsS "http://127.0.0.1:$HOST_PORT$route" | grep -q 'id="root"' ||
    fail "$route did not serve the app shell"
done

echo "==> a missing asset still 404s"
code="$(curl -sS -o /dev/null -w '%{http_code}' \
  "http://127.0.0.1:$HOST_PORT/assets/definitely-not-real.js")"
[ "$code" = "404" ] || fail "missing asset returned $code, expected 404"

echo "==> index.html is not cached, hashed assets are cached forever"
# index.html names the hashed bundles, so a browser that keeps an old copy after
# a deploy requests bundles that no longer exist and renders nothing until a
# hard reload. The bundles themselves are fingerprinted, so their content at a
# given URL never changes and they can be cached immutably.
root_cc="$(curl -sS -D- -o /dev/null "http://127.0.0.1:$HOST_PORT/" |
  tr -d '\r' | sed -n 's/^[Cc]ache-[Cc]ontrol: *//p')"
case "$root_cc" in
*no-cache* | *no-store*) ;;
*) fail "/ served with Cache-Control '$root_cc'; a stale index.html points at bundles that no longer exist" ;;
esac

asset="$(docker exec "$CID" sh -c 'ls /srv/assets | head -1')"
[ -n "$asset" ] || fail "no files under /srv/assets"
asset_cc="$(curl -sS -D- -o /dev/null "http://127.0.0.1:$HOST_PORT/assets/$asset" |
  tr -d '\r' | sed -n 's/^[Cc]ache-[Cc]ontrol: *//p')"
case "$asset_cc" in
*immutable*) ;;
*) fail "/assets/$asset served with Cache-Control '$asset_cc'; fingerprinted assets should be immutable" ;;
esac

echo "==> the Convex URL was inlined at build time"
docker exec "$CID" sh -c 'grep -rq "127.0.0.1:3210" /srv/assets' ||
  fail "VITE_CONVEX_URL was not inlined — check the ARG/ENV pair in the Dockerfile"

echo "==> web image smoke passed"
