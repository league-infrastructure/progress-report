#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

cd "${ROOT_DIR}"

set -a
. ./.env
set +a

APP_TAG="${APP_TAG:-$(node -p "require('./package.json').version")}"
DOCKER_CONTEXT="${DOCKER_CONTEXT:-swarm1}"
STACK_NAME="${STACK_NAME:-progress-report}"

export APP_TAG
export DOCKER_CONTEXT

exec docker stack deploy \
  --with-registry-auth \
  -c docker-compose.yml \
  "$STACK_NAME" \
  "$@"