#!/usr/bin/env bash
# Deploy one Railway service at a pinned commit, and wait for THAT deploy
# (BL-0006).
#
# Sourced by .github/workflows/promote.yml. It lives here rather than inline in
# the YAML so the polling logic can be read and changed without fighting block
# scalars, and so a mis-parse is a shell error rather than silent YAML.
#
# Expects in the environment: RAILWAY_TOKEN, PROJECT_ID, ENV_ID, SHA.
# shellcheck shell=bash

# Deployment ids, keyed by service name, recorded by deploy_service and read by
# wait_for_service. Both run in the same shell inside one workflow step.
declare -A DEPLOYMENT_IDS=()

_service_id() {
  local name=$1
  railway api "query { project(id: \"$PROJECT_ID\") { services { edges { node { id name } } } } }" |
    jq -r --arg n "$name" '.data.project.services.edges[].node | select(.name==$n) | .id'
}

# deploy_service <name> — start a deploy of SHA and record its deployment id.
# Returns as soon as it is queued; Railway builds asynchronously, which is why
# wait_for_service exists.
deploy_service() {
  local name=$1 id dep
  id="$(_service_id "$name")"
  [ -n "$id" ] && [ "$id" != "null" ] || {
    echo "::error::no service id for $name"
    return 1
  }
  # serviceInstanceDeployV2 returns the deployment id. Discarding it is what
  # made the old wait meaningless: it polled whichever deployment happened to
  # be latest, and a `railway config apply` elsewhere queues its own.
  dep="$(railway api "mutation { serviceInstanceDeployV2(serviceId: \"$id\", environmentId: \"$ENV_ID\", commitSha: \"$SHA\") }" |
    jq -r '.data.serviceInstanceDeployV2 // empty')"
  [ -n "$dep" ] || {
    echo "::error::$name: deploy returned no deployment id"
    return 1
  }
  DEPLOYMENT_IDS[$name]="$dep"
  echo "deploying $name ($id) at $SHA as deployment $dep"
  echo "- \`$name\` deploying at \`${SHA:0:9}\` (deployment \`${dep:0:8}\`)" >>"${GITHUB_STEP_SUMMARY:-/dev/null}"
}

# wait_for_service <name> [timeout_seconds] — block until the deployment THIS
# run started reaches a terminal state, and fail the promotion if that state is
# not a success.
#
# Without this the ordering in promote.yml would be nominal: the next step would
# start while this service was still building, and web could go live against
# functions that do not exist yet.
wait_for_service() {
  local name=$1 deadline=$((SECONDS + ${2:-900})) dep resp status commit
  dep="${DEPLOYMENT_IDS[$name]:-}"
  [ -n "$dep" ] || {
    echo "::error::$name: wait_for_service needs a deploy_service for the same service in the same shell"
    return 1
  }
  while [ "$SECONDS" -lt "$deadline" ]; do
    resp="$(railway api "query { deployment(id: \"$dep\") { status meta } }")"
    status="$(jq -r '.data.deployment.status // "UNKNOWN"' <<<"$resp")"
    case "$status" in
    # SLEEPING means it deployed and then went idle, which is what a
    # sleepApplication service does on purpose.
    SUCCESS | SLEEPING)
      commit="$(jq -r '.data.deployment.meta.commitHash // ""' <<<"$resp")"
      if [ -n "$commit" ] && [ "$commit" != "$SHA" ]; then
        echo "::error::$name deployed $commit, not the promoted $SHA"
        return 1
      fi
      echo "$name: $status at ${commit:-unknown}"
      return 0
      ;;
    # The only states that are still going somewhere. Everything else in
    # DeploymentStatus — FAILED, CRASHED, REMOVED, REMOVING, SKIPPED,
    # NEEDS_APPROVAL — is terminal or needs a human, and falling through to the
    # sleep below spent the whole timeout proving that.
    BUILDING | DEPLOYING | INITIALIZING | QUEUED | WAITING) ;;
    *)
      echo "::error::$name finished as $status"
      return 1
      ;;
    esac
    sleep 10
  done
  echo "::error::$name did not finish within the timeout (last status: ${status:-none})"
  return 1
}
