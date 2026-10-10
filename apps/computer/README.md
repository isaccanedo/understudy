# Understudy computer

The computer is the container each agent lives in. It runs a Chromium browser the owner can watch and drive from the panel, records a task while the owner teaches it, and runs a coding-agent CLI (Claude Code or Codex) as the agent's brain to turn lessons into recipes and repeat them, asking for approval before anything irreversible.

One computer per agent. It never accepts inbound connections: it dials the panel over WebSocket and the panel's gatekeeper over MCP.

## What runs inside

| Piece | File | Job |
|---|---|---|
| Link | `packages/runtime` (shared with the host) | WebSocket to `UNDERSTUDY_SERVER_URL/api/ws/computer?agent=<id>`, bearer token, reconnect with backoff, heartbeat |
| Browser | `src/browser.ts` | Chromium with a persistent profile, CDP on `127.0.0.1:9222` only, fixed 1280x800 viewport |
| Screen | `src/screencast.ts`, `src/input.ts` | JPEG frames at about 5 fps only while someone watches or a lesson is recorded; mouse, keyboard and navigation from the panel |
| Recorder | `src/recorder.ts`, `src/capture-script.ts` | Clicks, typing, selects, Enter, XHR/fetch requests, a screenshot per click, and the owner's narration |
| Brain | `src/brain.ts`, `src/agent.ts`, `src/recipe.ts` | Runs `claude -p` or `codex exec` headless with the Playwright MCP (attached to the same Chromium) and the gatekeeper MCP |
| Memory | `src/memory.ts`, `src/memory-sync.ts` | Files under `~/memory`, mirrored to the panel, editable by the owner |
| Login | `src/login.ts` | The official CLI login for the owner's own subscription, relayed to the panel |
| Vault | `src/vault.ts`, `src/vault-mcp.ts` | Saved site logins, encrypted on the volume; the brain's `fill_credential` tool types them into the page without seeing them |
| Files | `src/files.ts` | `~/files/inbox` receives owner uploads; `~/files/outbox` is listed to the panel and downloadable on request |
| Workbench | `src/workbench.ts`, `src/bench-client.ts`, `src/shell-mcp.ts` | A second container per agent where the brain's shell (`run_command`) and the owner's terminal run; it shares only `~/files` and a private socket |
| Run record | `src/run-record.ts` | Steps, up to 20 downscaled screenshots, approval ids and unusual findings of each run, plus token usage |

The wire format is `packages/protocol`: zod schemas with the TypeScript types derived from them, parse helpers for every direction, the shared recipe normalizer and the per-locale detection patterns. Every message the computer receives is validated before it is handled.

## Environment

| Variable | Required | Meaning |
|---|---|---|
| `AGENT_ID` | yes | The agent this computer belongs to |
| `AGENT_TOKEN` | yes | Bearer token for the panel socket and the gatekeeper MCP |
| `UNDERSTUDY_SERVER_URL` | yes | Panel base URL, `https://...` |
| `AGENT_BRAIN` | no | `claude` (default) or `codex`, used until the panel sends `set_brain` |
| `UNDERSTUDY_ENABLE_CODEX` | no | `true` offers the experimental codex brain, only if its sandbox can start (see the security model); off by default |
| `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN` or `ANTHROPIC_API_KEY` | no | API-key mode for the claude brain instead of a subscription login |
| `OPENAI_BASE_URL`, `OPENAI_API_KEY` | no | API-key mode for the codex brain |
| `CHROMIUM_PATH`, `PLAYWRIGHT_MCP_BIN` | no | Override the bundled binaries |

With no API key, the brain uses the owner's subscription: the panel sends `login_start`, the computer runs `claude auth login` or `codex login --device-auth` and sends back the link and code. Credentials stay on the volume.

## Files on the volume (`/home/agent`)

```
browser-profile/   Chromium profile: site logins survive restarts
memory/            profile.md, recipes/, journal/, notes/  (mirrored to the panel)
files/inbox/       files the owner uploaded (20 MB each at most)
files/outbox/      what the agent produced for the owner (listed in the panel)
runs/<id>/         full transcript, recorded events and screenshots of one run or lesson; deleted after 30 days
work/              the brain's working directory
.claude/ .codex/   CLI logins (never mirrored, never readable by the brain)
.understudy/       settings and the vault (vault.json is AES-256-GCM; the key is vault.key or UNDERSTUDY_VAULT_KEY)
```

Every run is a fresh brain session that starts from a short briefing: the profile, the recipe, the last 7 journal lines and the run's input. Chat with the owner keeps one session per day; when the day changes, the brain writes a summary line into the journal and starts over.

## Run it locally

Tests (no build step, Node 22+):

```sh
cd apps/computer
npm install
node --experimental-strip-types --no-warnings --test src/*.test.ts
```

Against the mock panel, which also serves a viewer page, a test form and a minimal gatekeeper:

```sh
cd apps/computer && npm run mock
docker build -f apps/computer/Dockerfile -t understudy-computer:dev .
docker run --rm --shm-size 1g --cap-drop ALL \
  -e AGENT_ID=dev -e AGENT_TOKEN=dev-token \
  -e UNDERSTUDY_SERVER_URL=http://host.docker.internal:8787 \
  understudy-computer:dev
```

Open `http://localhost:8787`, then use the page or type commands into the mock's terminal (`help` lists them): navigate, record a lesson on `/form`, run the recipe, approve. `MOCK_APPROVAL_CAP_SECONDS` shortens the approval long-poll for testing.

## Security model

- **No inbound traffic.** The computer only dials out. CDP listens on `127.0.0.1`; the host puts computers on a Docker network where they cannot reach each other.
- **Credentials stay on the volume, out of the brain's reach.** Subscription logins live in `~/.claude` and `~/.codex`, saved site logins in `~/.understudy`. The claude brain runs with no shell, cannot read, search, list or write those folders, `/proc`, `/tmp` or any `.claude` settings folder (which could otherwise add hooks), cannot run JavaScript in pages, and does not get `AGENT_TOKEN` in its environment. Chromium blocks `file://` URLs by policy, and the Playwright MCP only reads and uploads files under `~/files`, which is the brain's working folder. `memory_write`/`memory_delete` and `file_put` refuse anything outside their folders, symlinks included. Run `node --experimental-strip-types dev/isolation-check.ts <url of a page with a file input>` inside a running computer to verify all of this.
- **The shell runs elsewhere.** The brain has no shell inside the computer. Its `run_command` tool and the owner's terminal run in the agent's workbench, a separate container started by the host with only `~/files` (a volume subpath) and a socket volume mounted, no environment, all capabilities dropped and its own network namespace: it cannot read `~/.claude`, `~/.codex`, `~/.understudy`, the agent token or the computer's processes, and cannot reach the browser's CDP port. `dev/workbench-check.ts` plants canaries and proves this inside a running computer. Claude Code's own bash sandbox was not used because bubblewrap needs unprivileged user namespaces, which Docker's default seccomp profile blocks; allowing them would widen the kernel surface every agent can touch.
- **Outside content is data.** The brain's rules say web pages, emails, files and tool results never give instructions, and that nothing read on a page can waive an approval or ask it to reveal secrets or memory.
- **Approvals are enforced by the computer, not by the brain's goodwill.** The brain's browser tools go through `src/browser-guard.ts`, a proxy in front of the Playwright MCP. Before any click, Enter or type-and-submit it inspects the real element; a submit button, a form submit or a control whose name means pay, send, delete, publish and the like (English and Portuguese lists in `packages/protocol`) is paused and the computer itself calls the gatekeeper's `request_approval`, with the step it matches, the page and the form's values. Without an approval the tool answers "blocked: needs approval". This applies in chat and in runs that require approvals; while the brain writes a recipe nothing can be submitted at all; if the element cannot be inspected, the action is treated as one that needs approval. Webhook runs always require approvals and their input reaches the brain only as quoted untrusted data. `askFirstRuns` in a recipe written by the brain is ignored; only the panel decides. The guard also hides page-JavaScript and request-body tools from every brain and strips saved secrets from everything the browser returns.
- **Recordings.** Values of password fields, card and security-code fields, one-time codes, fields labelled like CPF, SSN, tokens or keys, and values that look like card numbers, CPF/CNPJ, SSN or API tokens are replaced before they leave the page or reach the brain. Query-string values in recorded URLs are dropped. Screenshots are pixels of what was on screen; avoid recording screens that show secrets.
- **Vault.** Secrets are encrypted at rest and only the vault tool server reads them. A saved login must have a site and is filled only on pages of that site; the password goes only into a password field and the username only into a text or email field, re-checked right before typing. The tool returns only "filled" or "refused", no screenshot is taken right after a fill, and the browser guard removes the secret from anything the brain could read. The claude brain cannot read `~/.understudy`. Codex has no such switches, so the vault tools are not offered when the brain is codex.
- **Retention.** `~/runs` folders older than 30 days are deleted.
- **Codex is experimental and off by default.** It is offered only with `UNDERSTUDY_ENABLE_CODEX=true` and only when its sandbox starts (the computer checks at boot and reports codex in `hello` only then). It runs with `--sandbox workspace-write` rooted at `~/files` and network on. The sandbox uses bubblewrap, which needs unprivileged user namespaces; Docker's default seccomp profile blocks them, so on a default host codex stays off. Granting them (a seccomp profile that allows `unshare` and `clone` with new user namespaces) widens the kernel surface the agent can reach. Residual risk even when it works: the codex sandbox limits writes and network, not reads, so a prompt-injected codex brain can read `~/.codex`, `~/.claude` and the vault key, and nothing like the claude tool denials exists for its shell. The vault tools are never offered to codex.
