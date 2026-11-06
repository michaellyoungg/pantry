#!/usr/bin/env bash
# Deploy one Railway service at a pinned commit, and wait for it (BL-0006).
#
# Sourced by .github/workflows/promote.yml. It lives here rather than inline in
# the YAML so the polling logic can be read and changed without fighting block
# scalars, and so a mis-parse is a shell error rather than silent YAML.
#
# Expects in the environment: RAILWAY_TOKEN, PROJECT_ID, ENV_ID, SHA.
# shellcheck shell=bash

_service_id() {
  local name=$1
  railway api "query { project(id: \"$PROJECT_ID\") { services { edges { node { id name } } } } }" |
    jq -r --arg n "$name" '.data.project.services.edges[].node | select(.name==$n) | .id'
}

# deploy_service <name> — start a deploy of SHA. Returns as soon as it is
# queued; Railway builds asynchronously, which is why wait_for_service exists.
deploy_service() {
  local name=$1 id
  id="$(_service_id "$name")"
  [ -n "$id" ] && [ "$id" != "null" ] || {
    echo "::error::no service id for $name"
    return 1
  }
  echo "deploying $name ($id) at $SHA"
  railway api "mutation { serviceInstanceDeployV2(serviceId: \"$id\", environmentId: \"$ENV_ID\", commitSha: \"$SHA\") }" >/dev/null
  echo "- \`$name\` deploying at \`${SHA:0:9}\`" >>"${GITHUB_STEP_SUMMARY:-/dev/null}"
}

# wait_for_service <name> [timeout_seconds] — block until its latest deployment
# reaches a terminal state, and fail the promotion if that state is not SUCCESS.
#
# Without this the ordering in promote.yml would be nominal: the next step would
# start while this service was still building, and web could go live against
# functions that do not exist yet.
wait_for_service() {
  local name=$1 deadline=$((SECONDS + ${2:-900})) id status
  id="$(_service_id "$name")"
  while [ "$SECONDS" -lt "$deadline" ]; do
    status="$(railway api "query { service(id: \"$id\") { serviceInstances { edges { node { environmentId latestDeployment { status } } } } } }" |
      jq -r --arg e "$ENV_ID" '.data.service.serviceInstances.edges[].node | select(.environmentId==$e) | .latestDeployment.status // "UNKNOWN"')"
    case "$status" in
    SUCCESS)
      echo "$name: SUCCESS"
      return 0
      ;;
    FAILED | CRASHED | REMOVED)
      echo "::error::$name finished as $status"
      return 1
      ;;
    esac
    sleep 10
  done
  echo "::error::$name did not finish within the timeout (last status: ${status:-none})"
  return 1
}
