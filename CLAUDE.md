# CLAUDE.md

@AGENTS.md
@docs/template-spec.md

## Project

Docker-based Node.js application template. Express backend, React frontend,
SQLite database, deployed to Docker Swarm.

## Stack

- **Backend:** Express + TypeScript (`server/`)
- **Frontend:** Vite + React + TypeScript (`client/`)
- **Database:** SQLite via Drizzle ORM (`better-sqlite3`); schema in `server/src/db/schema.ts`
- **Orchestration:** Docker Compose (dev), Docker Swarm (prod)
- **Secrets:** SOPS + age at rest, Swarm secrets at runtime (`secrets/`)
- **Reverse proxy:** Caddy with `*.jtlapp.net` wildcard domain

## Process

Follow the CLASI SE process defined in `AGENTS.md` by default.
Use `/se` or call `get_se_overview()` for process guidance.
Only skip the process if the stakeholder says "out of process" or "direct change."

## Docker Contexts

Docker context names are configured in `deploy.env`:
- `DEV_DOCKER_CONTEXT` — local Docker daemon for development (default: `orbstack`)
- `PROD_DOCKER_CONTEXT` — remote Docker host for production (default: `swarm1`)

All npm scripts that invoke Docker source `deploy.env` and set `DOCKER_CONTEXT`
automatically. Developers should edit `deploy.env` to match their local setup.

## Conventions

- TypeScript everywhere — backend and frontend
- All API routes prefixed with `/api`
- SQLite is the single data store — no separate database service required
- Secrets are never hardcoded; they flow through `docker/entrypoint.sh`
- Tests are layered: `tests/db/`, `tests/server/`, `tests/client/`, `tests/e2e/`
- Production domain pattern: `<appname>.jtlapp.net`

<!-- RUNDBAT:START -->
## rundbat — Deployment Expert

This project uses **rundbat** to manage Docker-based deployment
environments. rundbat handles Docker Compose generation, per-deployment
environment config (via dotconfig), secret management, and deployment
to remote Docker hosts.

**If a task involves Docker containers, docker-compose, deployment,
environment variables, secrets, or connection strings — use rundbat.**

Run `rundbat --instructions` for detailed agent-oriented instructions,
including the full help text for every subcommand. `rundbat --help`
shows the command list.

### Common commands

| Command | Purpose |
|---|---|
| `rundbat init` | Set up rundbat in a project |
| `rundbat generate` | Generate Docker artifacts from `config/rundbat.yaml` |
| `rundbat up <env>` | Start a deployment (checks out env from dotconfig) |
| `rundbat down <env>` | Stop a deployment |
| `rundbat restart <env>` | Restart (down + up; `--build` to rebuild) |
| `rundbat logs <env>` | Tail container logs |
| `rundbat deploy <env>` | Deploy to a remote Docker host |
| `rundbat deploy-init <env> --host ssh://...` | Register a remote target |

Most commands support `--json` for machine-parseable output, and `-v`
to print the shell commands they run.

### Configuration

Configuration is managed by dotconfig — **never edit `config/` files
or `docker/docker-compose.*.yml` directly**. Edit `config/rundbat.yaml`
and re-run `rundbat generate`; use `dotconfig` for env vars and secrets.

Read merged config: `dotconfig load -d <env> --json --flat -S`

Key locations:
- `config/rundbat.yaml` — Project-wide config (app name, deployments)
- `config/{env}/public.env` — Non-secret environment variables
- `config/{env}/secrets.env` — SOPS-encrypted credentials

### Reference files

`rundbat init` installs these files into `.claude/` for task-specific
guidance. Read them directly, or run `rundbat --instructions` for a
consolidated view that also dumps every subcommand's help text.

Rules:
- `.claude/rules/rundbat.md`

Agents:
- `.claude/agents/deployment-expert.md`

Skills (task-specific runbooks):
- `.claude/skills/rundbat/astro-docker.md`
- `.claude/skills/rundbat/deploy-init.md`
- `.claude/skills/rundbat/deploy-setup.md`
- `.claude/skills/rundbat/dev-database.md`
- `.claude/skills/rundbat/diagnose.md`
- `.claude/skills/rundbat/docker-best-practices.md`
- `.claude/skills/rundbat/docker-secrets-build.md`
- `.claude/skills/rundbat/docker-secrets-compose.md`
- `.claude/skills/rundbat/docker-secrets-swarm.md`
- `.claude/skills/rundbat/docker-secrets.md`
- `.claude/skills/rundbat/docker-swarm-deploy.md`
- `.claude/skills/rundbat/generate.md`
- `.claude/skills/rundbat/github-deploy.md`
- `.claude/skills/rundbat/init-docker.md`
- `.claude/skills/rundbat/manage-secrets.md`
<!-- RUNDBAT:END -->
