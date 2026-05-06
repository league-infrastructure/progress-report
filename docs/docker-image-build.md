# Docker Image Build Process

This project publishes a Docker image to GitHub Container Registry (GHCR) and
deploys that image to Docker Swarm.

The canonical image for this repository is:

`ghcr.io/league-infrastructure/progress-report`

The image should be public if Swarm worker nodes need to pull it without
depending on forwarded registry credentials.

## Overview

The build and deploy flow is:

1. Run the image build script.
2. The script bumps the application version.
3. The script reads the new version from `package.json`.
4. The script builds and pushes a multi-arch image to GHCR.
5. The deploy step sets `APP_TAG` to the current `package.json` version.
6. Docker Swarm updates the service to that versioned image.

The important design point is that the service should run a concrete versioned
tag such as `0.20260505.5`, not `latest`.

## Main Files

- `scripts/build_image.sh`
- `package.json`
- `Dockerfile`
- `docker-compose.yml`

## Build Script

The main entrypoint is:

```bash
npm run docker:build
```

That script just calls:

```bash
./scripts/build_image.sh
```

The build script owns the versioning and tag selection logic.

### What the build script does

`scripts/build_image.sh` does the following:

1. Changes to the repository root.
2. If `IMAGE_TAG` is not already set and `BUMP_VERSION=1`, runs:

   ```bash
   clasi version bump
   ```

3. Reads the new version from `package.json` and uses that as `IMAGE_TAG`.
4. Derives the image repo from `git remote get-url origin`.
5. Ensures a Docker Buildx builder exists with the `docker-container` driver.
6. Logs in to GHCR if a token is available.
7. Builds and pushes a multi-platform image.

### Current default behavior

- Bumps version automatically on build
- Pushes the versioned tag
- Also pushes `latest`
- Builds for:

```bash
linux/amd64,linux/arm64
```

## Important Environment Variables

These variables affect the image build:

- `IMAGE_REPO`
  Overrides the default GHCR repository name. Normally not needed.

- `IMAGE_TAG`
  Overrides the tag. If omitted, the build script uses the bumped/current
  `package.json` version.

- `PLATFORMS`
  Controls target architectures.
  Default: `linux/amd64,linux/arm64`

- `PUSH_LATEST`
  If `1`, the script also pushes `:latest`.
  If `0`, only the versioned tag is pushed.

- `BUILDER_NAME`
  Buildx builder name.
  Default: `progress-report-multiarch`

- `BUMP_VERSION`
  If `1`, and `IMAGE_TAG` is not set, the script runs `clasi version bump`
  before building.
  If `0`, the script does not bump.

- `GHCR_TOKEN` / `GITHUB_TOKEN`
  Registry auth token for GHCR.

- `GHCR_USERNAME` / `GITHUB_USERNAME` / `GITHUB_ACTOR`
  Registry username. If omitted, the script can derive the GitHub login from
  the token.

## How Versioning Works

The version source of truth is the root `package.json`.

Example:

```json
{
  "version": "0.20260505.5"
}
```

The build script bumps that version first, then reads it back and uses it as
the image tag.

That means after a successful build, the image tag should match the current
`package.json` version.

Example pushed tags:

- `ghcr.io/league-infrastructure/progress-report:0.20260505.5`
- `ghcr.io/league-infrastructure/progress-report:latest`

The deploy process should use the versioned tag, not `latest`.

## How the Image Repo Is Derived

The build script derives the repo from the Git remote.

For this repository:

```bash
https://github.com/league-infrastructure/progress-report.git
```

The derived image repo is:

```bash
ghcr.io/league-infrastructure/progress-report
```

This is important because GHCR packages are namespaced by owner.

- Owner: `league-infrastructure`
- Package name: `progress-report`

## How to Make the Package Show Up For the Repo

For GHCR to associate the package with the GitHub repository, the image must
carry the OCI source label.

This project sets it in `Dockerfile`:

```dockerfile
LABEL org.opencontainers.image.source="https://github.com/league-infrastructure/progress-report"
```

That label is what allows GitHub to connect the container package back to the
repository.

## Package Visibility

If Swarm workers must pull the image directly, the simplest setup is to make
the GHCR package public.

If the package is private, worker nodes may fail with errors like:

```text
No such image: ghcr.io/league-infrastructure/progress-report:...
```

even when the manager can deploy successfully.

Recommended practice for this project:

- Keep the repository visibility however you want.
- Make the GHCR package public if the runtime environment needs unauthenticated
  pulls.

## Dockerfile Requirements

The Dockerfile must reflect the real runtime stack.

For this repo, the important points are:

- Build the server with TypeScript output
- Build the client with Vite
- Copy `dist` into the runtime image
- Copy Drizzle migrations/config into the runtime image
- Start the server from compiled output
- Run Drizzle migrations at startup

Current runtime command shape:

```dockerfile
CMD ["sh", "-c", "node_modules/.bin/drizzle-kit migrate && node dist/index.js"]
```

## Deploy Process

Build and push image:

```bash
npm run docker:build
```

Deploy to Swarm:

```bash
npm run docker:deploy
```

The deploy script sets:

```bash
APP_TAG=$(node -p "require('./package.json').version")
```

so the stack updates to the same versioned image that was just built.

Check the deployed service:

```bash
npm run docker:deploy:ps
```

Expected output shape:

```text
ghcr.io/league-infrastructure/progress-report:0.20260505.5
```

## Recommended Conventions For Other Repos

If you copy this workflow into another repository, keep these conventions:

1. Put version bumping inside the build script, not inside `package.json`.
2. Use the root `package.json` version as the image tag source of truth.
3. Derive `IMAGE_REPO` from `git remote get-url origin`.
4. Add `org.opencontainers.image.source` to the Dockerfile.
5. Use a concrete version tag for deploys, not `latest`.
6. Keep `latest` optional and secondary.
7. Make the GHCR package public if worker nodes need direct pulls.
8. Use a persistent `docker-container` Buildx builder for multi-arch builds.

## Troubleshooting

### Build works locally but multi-arch build fails

Cause:

- Buildx is using the plain `docker` driver instead of `docker-container`

Fix:

- Ensure the build script creates/uses a `docker-container` builder

### Swarm service stays at `0/1`

Cause:

- Worker cannot pull the image

Checks:

- `docker service ps <service> --no-trunc`

Common fix:

- make the image public, or
- deploy with `--with-registry-auth`

### Package shows under org but not repo

Cause:

- missing OCI source label or missing package/repo association

Fix:

- add `org.opencontainers.image.source`
- repush the image

### App deploys on `latest` instead of a numbered version

Cause:

- deploy script is not setting `APP_TAG` from `package.json`

Fix:

- make the deploy script export `APP_TAG=$(node -p "require('./package.json').version")`