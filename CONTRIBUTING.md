# Contributing

Thanks for helping. This guide covers how the code is laid out, how to run it on your machine, and what a pull request needs.

## Layout

| Folder | What it is |
|---|---|
| `apps/web` | Next.js panel, API, WebSocket hub, gatekeeper MCP and scheduler |
| `apps/computer` | The container each agent lives in: Chromium, screencast, recorder, brain runner |
| `apps/host` | Supervisor that keeps one computer container per agent through the Docker socket |
| `packages/protocol` | Message types shared by the three apps |
| `packages/characters` | The agents' faces |
| `infra` | Scripts and manifests for an AWS + Kubernetes deployment |

Read `docs/ARCHITECTURE.md` first. Changing `packages/protocol` is a contract change between apps: keep it backwards compatible or update every app in the same pull request.

## Requirements

- Node.js 22 or newer and pnpm 10 (`corepack enable`)
- Docker (Docker Desktop on macOS and Windows)
- PostgreSQL 16, or the one from `docker compose`

## Run the panel

```sh
pnpm install
cp example.env .env
cp apps/web/.env.example apps/web/.env
```

In the root `.env`, set `BETTER_AUTH_SECRET` and `UNDERSTUDY_HOST_TOKEN` to long random strings (`openssl rand -hex 32`); compose refuses to start without them. Copy the same two values into `apps/web/.env`, point its `DATABASE_URL` at `postgres://understudy:understudy@localhost:55432/understudy`, and put your email in `UNDERSTUDY_ADMIN_EMAILS`. Then:

```sh
docker compose up -d postgres
pnpm dev
```

The panel runs migrations on start and listens on http://localhost:3000. On an empty database it opens a setup page to create the first admin account. `pnpm --filter @understudy/web create-user --email you@example.com --name "Your Name"` creates accounts from the command line.

To see the whole loop without Docker, `apps/web/scripts/fake-host.ts` simulates a host and its computers (see `apps/web/README.md`).

## Run a computer without the panel

`apps/computer` ships a mock panel that serves a viewer page, a test form and a minimal gatekeeper, so you can work on the computer alone. From the repository root:

```sh
pnpm --filter @understudy/computer mock
docker build -f apps/computer/Dockerfile -t understudy-computer:local .
docker run --rm --shm-size 1g --cap-drop ALL \
  -e AGENT_ID=dev -e AGENT_TOKEN=dev-token \
  -e UNDERSTUDY_SERVER_URL=http://host.docker.internal:8787 \
  understudy-computer:local
```

Open http://localhost:8787. `apps/computer/README.md` has the details.

## Run the host against your panel

From the repository root:

```sh
docker build -f apps/computer/Dockerfile -t understudy-computer:local .
docker build -f apps/host/Dockerfile -t understudy-host:local .
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
  -e UNDERSTUDY_SERVER_URL=http://host.docker.internal:3000 \
  -e UNDERSTUDY_HOST_TOKEN=<same value as in apps/web/.env> \
  -e UNDERSTUDY_COMPUTER_IMAGE=understudy-computer:local \
  -e UNDERSTUDY_COMPUTER_EXTRA_HOSTS=host.docker.internal:host-gateway \
  understudy-host:local
```

Set `UNDERSTUDY_COMPUTER_SERVER_URL=http://host.docker.internal:3000` in `apps/web/.env` so computers can reach the panel. Create an agent in the panel and the host starts its computer. `apps/host/README.md` explains every variable. To run everything at once instead, use `docker compose` as described in the README.

## Tests

```sh
pnpm -r test
```

The panel's database tests run only when `TEST_DATABASE_URL` points to a disposable Postgres, for example `postgres://understudy:understudy@localhost:55432/understudy_test` with the compose database. CI runs them, plus the type check of every package that has a `tsconfig.json`.

## Pull requests

- One change per pull request, with a description of what changes for the person using Understudy and how you checked it.
- Add or update tests for behavior you change.
- No comments in code, configuration or scripts: names carry the meaning. Tool directives such as `eslint-disable` are the only exception.
- Code, tests, commit messages and documentation are in English. User-facing text goes through `apps/web/src/lib/i18n`; add the English string and, if you can, its translations.
- Nothing specific to one deployment (domains, email domains, account ids, workspace ids) goes into code: make it configuration.
- Never commit secrets, real user data or screenshots that show them.
- By contributing you agree that your contribution is licensed under the Apache License 2.0.

Security problems go through `SECURITY.md`, not issues.
