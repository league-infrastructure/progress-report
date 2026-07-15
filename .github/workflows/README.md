# CI/CD — Build & Deploy

`deploy.yml` builds the app image on a GitHub-hosted runner, pushes it to
GHCR, and deploys the stack to the `swarm1` Docker Swarm over SSH. This
replaces the local `npm run docker:build` + `npm run docker:deploy` flow so
no developer machine has to do the heavy lifting.

## When it runs

- On every push to the sprint branch (`sprint/002-...`).
- Manually, via the **Actions → Build & Deploy → Run workflow** button.

To point it at `master` after merging, change the branch under `on.push`.

## Required repository secrets

Add these under **Settings → Secrets and variables → Actions → New repository
secret** (org admin access to `league-infrastructure` may be required):

| Secret | What it is |
|---|---|
| `SWARM_SSH_KEY` | A **private** SSH key whose public half is in `root@swarm1.dojtl.net`'s `authorized_keys`. Paste the full PEM (`-----BEGIN … END-----`). |
| `SWARM_SSH_KNOWN_HOSTS` | The swarm host key lines, so SSH doesn't prompt. Get them with: `ssh-keyscan -t ed25519,rsa swarm1.dojtl.net`. |
| `PROD_ENV_FILE` | The **entire** contents of the production `.env` (all app secrets — the container reads them via `env_file`). Paste the file verbatim. |

`GITHUB_TOKEN` (GHCR push) is provided automatically — no secret needed.

## Notes

- The image tag is `package.json`'s version, the same source of truth the
  local scripts use. Bump it per commit; the workflow deploys whatever the
  version is at push time.
- The container migrates the DB and boot-seeds quizzes on startup, and the
  seeder now adds new levels (e.g. Java) additively without wiping student
  data — so a deploy is all that's needed to make new quiz content live.
- The build is `linux/amd64` only (the swarm's arch) and runs natively on the
  runner — no QEMU emulation.
