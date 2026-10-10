# Understudy web panel

The panel people use, plus everything the computers and hosts talk to: one Node process that serves the Next.js app, the WebSockets at `PATHS` from `@understudy/protocol`, the gatekeeper MCP at `/api/mcp`, and the recipe scheduler.

## Run locally

```sh
createdb understudy
cp .env.example .env
pnpm --filter @understudy/web dev
```

`server.ts` runs the migrations in `drizzle/` on start. Create the first account from the command line (or list your email in `UNDERSTUDY_ADMIN_EMAILS` and let an admin create it in the panel):

```sh
pnpm --filter @understudy/web create-user --email you@example.com --name "Your Name"
```

Anyone from a domain in `UNDERSTUDY_ALLOWED_EMAIL_DOMAIN` (one or more, comma separated) can sign up with email and password and waits for an admin to approve them; without an allowed domain, public sign-up is closed. Email and password sign-ups are never verified, so they never become admin and are never approved on their own, and signing up with an address listed in `UNDERSTUDY_ADMIN_EMAILS` is refused. An admin is a listed email whose account was created by an admin, by the `create-user` command, or through Google with a verified email; when the list is empty, the first account created on a fresh database (the `/setup` page) becomes the admin. Admins can create accounts with a temporary password that must be changed at first sign-in. When `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set, Google sign-in appears and verified accounts from an allowed domain get in directly.

To see the whole loop without real computers, run the fake host. It answers `computer_ensure` with a simulated computer that streams a fixed frame, records, returns a recipe, asks for approval through the gatekeeper and keeps a small memory:

```sh
FAKE_FRAME_JPEG=/path/to/any.jpg npx tsx scripts/fake-host.ts
```

## Configuration

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `BETTER_AUTH_SECRET` | Session signing, also the key for sealed MCP headers |
| `UNDERSTUDY_PUBLIC_URL` | Public URL of the panel; computers and Slack links use it |
| `UNDERSTUDY_COMPUTER_SERVER_URL` | Optional. URL the computers use to reach the panel when it differs from the public one (e.g. `http://host.docker.internal:3000` in docker-compose). Defaults to `UNDERSTUDY_PUBLIC_URL` |
| `UNDERSTUDY_ALLOWED_EMAIL_DOMAIN` | Only these email domains (comma separated) can have an account |
| `UNDERSTUDY_ADMIN_EMAILS` | Comma separated; these people manage accounts and connected tools |
| `UNDERSTUDY_SECRET_KEY` | Optional. Key for the sealed MCP auth headers; falls back to `BETTER_AUTH_SECRET`. Changing it makes stored headers unreadable, so re-enter them |
| `UNDERSTUDY_HOST_TOKEN` | Bearer token the host supervisor uses on `/api/ws/host` |
| `UNDERSTUDY_HOST_IDS` | Optional. Comma-separated host ids allowed to connect. Without it, the first host to connect is trusted and any other waits for an admin to trust it in the People page. Each understudy stays on the host that first started it until an admin stops trusting that host |
| `UNDERSTUDY_ALLOW_PRIVATE_MCP` | Set to `1` only in local development to let connected tools live on private or loopback addresses. By default the panel refuses tool addresses that resolve to private, loopback, link-local, CGNAT or metadata ranges, and checks the address again at connect time |
| `UNDERSTUDY_BLOCKED_CIDRS` | Optional. Extra comma-separated ranges the panel never connects to for tools, such as the cluster's pod and service CIDRs |
| `UNDERSTUDY_TRANSCRIBER` | Optional. Speech-to-text for narration recorded by the browser extension: `gateway` (Vercel AI Gateway REST), `openai` (any OpenAI-compatible `/audio/transcriptions` endpoint), `fake` (development) or `off`. Without it, `gateway` is used when `AI_GATEWAY_API_KEY` is set; otherwise the voice is dropped and only the steps are kept |
| `UNDERSTUDY_TRANSCRIBE_API_KEY` | Key for the transcriber. For `gateway` it falls back to `AI_GATEWAY_API_KEY` |
| `UNDERSTUDY_TRANSCRIBE_MODEL` | Optional. Defaults to `openai/whisper-1` (gateway) or `whisper-1` (openai). Use a model that returns segment timestamps so narration lines up with the steps |
| `UNDERSTUDY_TRANSCRIBE_URL` | Optional. Base URL of the transcriber (`https://ai-gateway.vercel.sh` or `https://api.openai.com/v1` by default) |
| `UNDERSTUDY_TRANSCRIBE_LANGUAGE` | Optional. ISO language hint for the transcriber, e.g. `pt` |
| `UNDERSTUDY_EXTENSION_DIR` | Optional. Folder with the built extension that `/api/extension/package.zip` serves. Defaults to `../extension/dist` next to the app |
| `UNDERSTUDY_COMPUTER_IMAGE` | Image sent in `computer_ensure` (the host may override it) |
| `UNDERSTUDY_PRODUCT_NAME` | Name shown in the panel, default `Understudy` |
| `UNDERSTUDY_ARTIFACT_S3_BUCKET` | Bucket for artifact versions and page images. Any S3-compatible store works (AWS S3, MinIO, SeaweedFS, Garage). Empty keeps them in Postgres |
| `UNDERSTUDY_ARTIFACT_S3_ENDPOINT`, `UNDERSTUDY_ARTIFACT_S3_REGION` | Endpoint (default `https://s3.<region>.amazonaws.com`, path-style) and region (default `AWS_REGION` or `us-east-1`) |
| `UNDERSTUDY_ARTIFACT_S3_ACCESS_KEY_ID`, `UNDERSTUDY_ARTIFACT_S3_SECRET_ACCESS_KEY` | Keys for that bucket; fall back to `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and `AWS_SESSION_TOKEN` |
| `UNDERSTUDY_ARTIFACT_MAX_BYTES` | Largest file one artifact version can hold (25 MB by default) |
| `UNDERSTUDY_ARTIFACT_AGENT_MAX_BYTES` | Total size of every artifact version one understudy can keep (1 GB by default) |
| `UNDERSTUDY_ARTIFACT_ORIGIN` | Optional separate origin (another registrable domain) that serves artifact content; without it content is served from the panel host, already sandboxed with an opaque origin |
| `UNDERSTUDY_LOCALE` | `en` (default) or `pt-BR` |
| `UNDERSTUDY_TIMEZONE` | Default time zone for dates and new schedules, default `UTC` |
| `UNDERSTUDY_BRIEFING_CRON` | When the daily Slack briefing goes out, default `0 8 * * 1-5`; `off` disables it |
| `SLACK_BOT_TOKEN` | Optional. Enables approval DMs (`users.lookupByEmail`, `chat.postMessage`) and the `slack_post` tool |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Optional Google sign-in |

## Gatekeeper

`/api/mcp` is a stateless streamable HTTP MCP server authenticated by the computer token. Every call is logged in `tool_calls`.

- `request_approval` and `wait_for_approval`: long-poll. Each call waits up to 30 minutes and returns `approved`, `denied` (optionally `: note`) or `{"status":"pending","requestId":...}`. An approval expires after 24 hours.
- `notify_owner`, `slack_post`: when the owner enabled them.
- Connected tools: admins register MCP servers (URL plus an optional auth header, stored encrypted). Owners pick which ones their understudy gets, and can mark single tools as "ask me first", which wraps the call in an approval.

## Tests

`pnpm --filter @understudy/web test` runs the unit tests. The database tests in `src/server/hub.db.test.ts` run only when `TEST_DATABASE_URL` points to a disposable Postgres (they create and delete their own rows).

## Translations

English in `src/lib/i18n/en.ts` is the source. Add a language by copying it to a new file typed as `Messages` and registering it in `src/lib/messages.ts`.

## Probes

`/api/live` answers 200 while the process serves, without touching the database (liveness). `/api/health` also checks the database and returns 503 when it is unreachable (readiness).

## Known limits

- Run a single replica. Connected computers, viewers, pending approval waiters and the scheduler live in process memory.
- The ingress must allow long-lived connections on `/api/ws/*` and `/api/mcp` (an hour or more).

## Build

`pnpm build` runs `next build` (standalone output) and bundles `server.ts` and `scripts/create-user.ts` into `dist/` with esbuild. `Dockerfile` builds from the repository root and runs `node dist/server.mjs`; inside the container, `node dist/create-user.mjs --email ...` creates an account.
