#!/usr/bin/env bash
set -euo pipefail

DEPLOY_HOST="${DEPLOY_HOST:-root@2.31.2.198}"
DEPLOY_DIR="${DEPLOY_DIR:-/opt/intouchsocial}"
BRANCH="main"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT_DIR"
if [[ "$(git branch --show-current)" != "$BRANCH" ]]; then
  printf 'Deploy from %s only.\n' "$BRANCH" >&2
  exit 1
fi

git fetch origin "$BRANCH"
if [[ "$(git rev-parse HEAD)" != "$(git rev-parse "origin/$BRANCH")" ]]; then
  printf 'Push the current commit to origin/%s before deploying.\n' "$BRANCH" >&2
  exit 1
fi

git archive --format=tar HEAD | ssh "$DEPLOY_HOST" "mkdir -p '$DEPLOY_DIR' && tar -xf - -C '$DEPLOY_DIR'"

ssh "$DEPLOY_HOST" "bash -s -- '$DEPLOY_DIR'" <<'REMOTE'
set -euo pipefail
cd "$1"

deployment_token="$(sed -n 's/^JWT_SECRET=//p' .env.production | head -n 1)"
if [[ -z "$deployment_token" ]]; then
  printf 'JWT_SECRET is missing from .env.production.\n' >&2
  exit 1
fi

announce() {
  response_code="$(printf 'x-deployment-token: %s\ncontent-type: application/json\n' "$deployment_token" |
    curl --silent --show-error --connect-timeout 5 \
      -X POST https://api.intouchsocial.com/system/deployment \
      -H @- \
      --data "{\"status\":\"$1\"}" \
      -o /dev/null -w '%{http_code}')"
  [[ "$response_code" == "200" ]]
}

deployment_started=0
announcement_supported=1
on_exit() {
  exit_code=$?
  if [[ "$exit_code" -ne 0 && "$deployment_started" -eq 1 && "$announcement_supported" -eq 1 ]]; then
    announce failed || true
  fi
}
trap on_exit EXIT

if announce started; then
  deployment_started=1
else
  if [[ "$response_code" != "404" ]]; then
    printf 'Deployment announcement failed (HTTP %s).\n' "$response_code" >&2
    exit 1
  fi
  response_code="$(curl --silent --show-error --connect-timeout 5 -o /dev/null -w '%{http_code}' https://api.intouchsocial.com/health)"
  if [[ "$response_code" != "200" ]]; then
    printf 'Deployment announcement failed (HTTP %s).\n' "$response_code" >&2
    exit 1
  fi
  printf 'Announcement endpoint not installed yet; bootstrapping without a user notice.\n' >&2
  announcement_supported=0
fi

docker compose --env-file .env.production -f compose.production.yaml up -d --build --wait api web
curl --silent --show-error --fail https://api.intouchsocial.com/health >/dev/null
if [[ "$announcement_supported" -eq 1 ]]; then
  announce complete
  deployment_started=0
fi
REMOTE