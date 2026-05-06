#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PLATFORMS="${PLATFORMS:-linux/amd64,linux/arm64}"
PUSH_LATEST="${PUSH_LATEST:-1}"
BUILDER_NAME="${BUILDER_NAME:-progress-report-multiarch}"
REGISTRY_USERNAME="${GHCR_USERNAME:-${GITHUB_USERNAME:-${GITHUB_ACTOR:-}}}"
REGISTRY_TOKEN="${GHCR_TOKEN:-${GITHUB_TOKEN:-}}"
BUMP_VERSION="${BUMP_VERSION:-1}"
DRY_RUN=0

derive_registry_username() {
  local login

  login="$({
    curl -fsSL https://api.github.com/user \
      -H "Accept: application/vnd.github+json" \
      -H "Authorization: Bearer ${REGISTRY_TOKEN}" \
      -H "X-GitHub-Api-Version: 2022-11-28" \
    | python3 -c 'import json, sys; print(json.load(sys.stdin).get("login", ""))'
  } 2>/dev/null || true)"

  if [[ -z "${login}" || "${login}" == "None" ]]; then
    echo "Unable to determine GitHub username from GITHUB_TOKEN/GHCR_TOKEN. Set GHCR_USERNAME, GITHUB_USERNAME, or GITHUB_ACTOR explicitly." >&2
    exit 1
  fi

  echo "${login}"
}

derive_image_repo() {
  local remote_url repo_path

  remote_url="$(git remote get-url origin 2>/dev/null || true)"
  if [[ -z "${remote_url}" ]]; then
    echo "Unable to determine IMAGE_REPO from git origin. Set IMAGE_REPO explicitly." >&2
    exit 1
  fi

  case "${remote_url}" in
    git@github.com:*)
      repo_path="${remote_url#git@github.com:}"
      ;;
    https://github.com/*)
      repo_path="${remote_url#https://github.com/}"
      ;;
    ssh://git@github.com/*)
      repo_path="${remote_url#ssh://git@github.com/}"
      ;;
    *)
      echo "Unsupported origin remote for GHCR: ${remote_url}" >&2
      exit 1
      ;;
  esac

  repo_path="${repo_path%.git}"
  repo_path="$(printf '%s' "${repo_path}" | tr '[:upper:]' '[:lower:]')"
  echo "ghcr.io/${repo_path}"
}

usage() {
  cat <<EOF
Usage: $(basename "$0") [--dry-run]

Build and push the project image to GitHub Container Registry using Docker Buildx.

Environment:
  IMAGE_REPO     Target image repo. Default: derived from git origin
  IMAGE_TAG      Target image tag. Default: bumped/current package.json version
  PLATFORMS      Build platforms. Default: ${PLATFORMS}
  PUSH_LATEST    Set to 0 to skip the latest tag. Default: ${PUSH_LATEST}
  BUILDER_NAME   Buildx builder name. Default: ${BUILDER_NAME}
  BUMP_VERSION   Set to 0 to skip automatic version bump when IMAGE_TAG is unset
  GHCR_USERNAME  GitHub username for docker login to ghcr.io
  GITHUB_USERNAME GitHub username fallback for docker login to ghcr.io
  GITHUB_ACTOR   GitHub actor fallback for docker login to ghcr.io
  GHCR_TOKEN     Personal access token for docker login to ghcr.io
  GITHUB_TOKEN   GitHub token fallback for docker login to ghcr.io

Examples:
  $(basename "$0")
  IMAGE_TAG=main-$(git rev-parse --short HEAD) $(basename "$0")
  PLATFORMS=linux/amd64 $(basename "$0") --dry-run
EOF
}

ensure_builder() {
  local driver

  if docker buildx inspect "${BUILDER_NAME}" >/dev/null 2>&1; then
    driver="$(docker buildx inspect "${BUILDER_NAME}" | awk -F': *' '/^Driver:/ { print $2; exit }')"
    if [[ "${driver}" != "docker-container" ]]; then
      echo "Buildx builder ${BUILDER_NAME} uses unsupported driver ${driver}; expected docker-container." >&2
      exit 1
    fi
    return
  fi

  if [[ ${DRY_RUN} -eq 1 ]]; then
    echo "DRY RUN: docker buildx create --name ${BUILDER_NAME} --driver docker-container --use"
    echo "DRY RUN: docker buildx inspect --bootstrap ${BUILDER_NAME}"
    return
  fi

  docker buildx create --name "${BUILDER_NAME}" --driver docker-container --use
  docker buildx inspect --bootstrap "${BUILDER_NAME}" >/dev/null
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

cd "${ROOT_DIR}"

if [[ -z "${IMAGE_TAG:-}" && "${BUMP_VERSION}" == "1" && ${DRY_RUN} -eq 0 ]]; then
  clasi version bump
fi

IMAGE_TAG="${IMAGE_TAG:-$(node -p "require('./package.json').version" 2>/dev/null)}"

if [[ -z "${IMAGE_TAG}" ]]; then
  echo "Unable to determine IMAGE_TAG." >&2
  exit 1
fi

if [[ -n "${REGISTRY_TOKEN}" ]]; then
  if [[ "${REGISTRY_TOKEN}" == "your-github-token" ]]; then
    echo "GITHUB_TOKEN/GHCR_TOKEN is set to the placeholder value 'your-github-token'. Provide a real token with package write access." >&2
    exit 1
  fi

  if [[ -z "${REGISTRY_USERNAME}" ]]; then
    REGISTRY_USERNAME="$(derive_registry_username)"
  fi

  if [[ ${DRY_RUN} -eq 1 ]]; then
    echo "DRY RUN: echo '***' | docker login ghcr.io -u ${REGISTRY_USERNAME} --password-stdin"
  else
    echo "Logging into ghcr.io as ${REGISTRY_USERNAME}"
    printf '%s' "${REGISTRY_TOKEN}" | docker login ghcr.io -u "${REGISTRY_USERNAME}" --password-stdin
  fi
fi

IMAGE_REPO="${IMAGE_REPO:-$(derive_image_repo)}"

ensure_builder

TAGS=(--tag "${IMAGE_REPO}:${IMAGE_TAG}")
if [[ "${PUSH_LATEST}" == "1" ]]; then
  TAGS+=(--tag "${IMAGE_REPO}:latest")
fi

BUILD_CMD=(
  docker buildx build
  --builder "${BUILDER_NAME}"
  --platform "${PLATFORMS}"
  --file Dockerfile
  "${TAGS[@]}"
  --push
  .
)

echo "Building ${IMAGE_REPO}:${IMAGE_TAG} for ${PLATFORMS}"

if [[ ${DRY_RUN} -eq 1 ]]; then
  printf 'DRY RUN:'
  printf ' %q' "${BUILD_CMD[@]}"
  printf '\n'
  exit 0
fi

"${BUILD_CMD[@]}"

echo "Pushed ${IMAGE_REPO}:${IMAGE_TAG}"
if [[ "${PUSH_LATEST}" == "1" ]]; then
  echo "Pushed ${IMAGE_REPO}:latest"
fi




