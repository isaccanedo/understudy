# Understudy architecture

Understudies are persistent AI coworkers for non-technical teams. Each understudy has its own isolated computer (a container with Chromium), runs on the subscription its owner logged into (Claude Code or Codex CLI), learns a task by watching its owner do it once, and repeats it, asking for approval before irreversible steps.

## Pieces

| Piece | Where it runs | Folder |
|---|---|---|
| Web panel + API + WebSocket hub + gatekeeper MCP + scheduler | Kubernetes, behind `UNDERSTUDY_PUBLIC_URL` | `apps/web` |
| Host supervisor: creates/stops one container per understudy | A VM in an isolated network | `apps/host` |
| Computer: Chromium, screencast, recorder, brain runner | One container per understudy, on the host | `apps/computer` |
| Shared wire types | everywhere | `packages/protocol` |
| Infra scripts and manifests | AWS + Kubernetes | `infra` |

## Direction of connections

Nothing ever connects into the isolated network. The host and every computer dial out to the panel over WSS:

- host → `wss://<panel>/api/ws/host` with `Authorization: Bearer $UNDERSTUDY_HOST_TOKEN`
- computer → `wss://<panel>/api/ws/computer?agent=<id>` with `Authorization: Bearer <computer token>`
- browser → `wss://<panel>/api/ws/viewer?agent=<id>` with the user's session cookie
- computer brain → `https://<panel>/api/mcp` (streamable HTTP MCP) with the computer token

Message shapes live in `packages/protocol/src/index.ts`. Changing them is a contract change between apps; keep it backwards compatible or update all three apps in the same PR.

## Lifecycle

1. A user creates an understudy in the panel. The panel stores it, mints a random computer token (only its hash is stored), and sends `computer_ensure` to a connected host.
2. The host runs the computer image with `AGENT_ID`, `AGENT_TOKEN`, `UNDERSTUDY_SERVER_URL` and a named volume for `/home/agent` (browser profile, CLI logins, recordings). It reports `computer_status`.
3. The computer connects, sends `hello` with which brains are logged in, then streams `frame`s (CDP screencast, JPEG) while a viewer is watching.
4. Login: the panel sends `login_start`; the computer runs the official CLI login flow and replies `login_prompt` with the URL/code to show the user; the user may paste a code back with `login_code`; the computer replies `login_done`. Credentials never leave the computer volume.
5. Teaching: `record_start` → the user drives the browser through the viewer (`input` events) and narrates (`record_narration`) → the computer captures DOM-level events and network requests as `recorded` → `record_stop` → the brain turns the log into a `Recipe` and replies `recipe`.
   Teaching from the owner's own browser: the extension (`apps/extension`) pairs with the panel through a one-time code shown in the panel (it never sees the password) and gets a token whose hash is stored. While recording it runs the same capture script and the same secret masking as the computer (`packages/protocol/src/capture.ts`) in the owner's tabs, records the voice with `MediaRecorder` in an offscreen document, and posts events and audio clips to `/api/extension/*`. On stop the panel transcribes the clips, places each transcript segment at its clip's start time plus the segment offset, deletes the audio, merges narration and steps into one timeline and sends it to the computer as `teach_recording`; the brain writes the recipe as in the remote mode.
6. Running: `run_recipe` → the brain executes in the browser (Playwright MCP over CDP to the local Chromium) and calls the gatekeeper's `request_approval` tool before every `ask` step; the panel shows the request and notifies the owner; the answer comes back as the tool result.

## Security rules

- Subscription credentials stay on the computer volume. The panel never sees them.
- Password fields are masked in recordings (`masked: true`, value replaced).
- The gatekeeper only exposes tools the owner enabled for that understudy, and logs every call.
- Slack and connectors are gatekeeper tools too. The `slack_*` tools (list channels, read, join, post, DM, share a file from `~/files/outbox`) use the panel's Slack app and post with the understudy's name and face; each owner picks per understudy whether they ask first (default), post without asking, or are off. Owner rules are checked on every outward call, even without asking, and writes are rate limited per understudy. Connectors are remote MCP servers an admin adds under People; the panel tests one when it is added and lists its actions, and owners mark which actions ask first.
- The isolated network has no route to production networks; egress is internet only.
- Everything specific to one deployment (domain, allowed email domain, Slack workspace) is configuration, never code.

## Always on

Understudies do not depend on their owner being online. The computer runs 24/7 on the host; the panel's scheduler and triggers start runs; approvals wait in the panel (and optionally Slack) until answered, and the run resumes from the approval.

## Memory without blowing the context

No conversation grows forever. Every run is a fresh brain session that starts from a small, fixed briefing and reads more only on demand.

- `~/memory/profile.md`: who the understudy is, its owner, its role, its rules. Short, edited by the owner and by the understudy itself.
- `~/memory/recipes/<id>.md`: one file per learned task, the compact recipe.
- `~/memory/journal/YYYY-MM-DD.md`: one line per run outcome, written at the end of every run.
- `~/memory/notes/*.md`: facts the understudy decided to keep (`remember` writes here; `recall` searches here).
- `~/runs/<runId>/`: full transcript, screenshots and recorded events of that run. Never loaded into a new session; only searched when needed.

A run's briefing is: profile + the recipe being run + the last 7 journal lines + the task input. Chat with the owner uses one rolling session per day; when it ends, the brain writes a short summary into the journal and the next day starts fresh. Long recordings are reduced before reaching the brain: consecutive inputs on the same field collapse, network requests keep only method, path and status, and screenshots are sampled. The brain CLIs also compact on their own; the files above are what survives compaction.

## Rooms

A room is a group chat between an owner and two or more of their own understudies (`rooms`, `room_participants`, `room_messages`). Only the owner reads it or writes in it, over `wss://<panel>/api/ws/room?room=<id>`.

- The owner's message wakes every participant, or only the ones named with `@Name`. Each wake is a `room_turn` to the computer: a fresh brain session whose prompt says it is a group room, who is in it, how to address someone, the recent transcript as quoted data, and that teammates never authorize irreversible steps.
- The computer tags what that turn says, streams and does with the `roomId`, so it lands in the room and not in the private chat, drops a reply that is only `PASS`, and ends with `room_turn_done`.
- An understudy's message wakes only the teammates it names, one level deeper. There is no limit by default: they go on as long as they keep naming each other. A teammate named while it is still working gets one more turn after it finishes instead of a parallel one. A turn that does not finish in 15 minutes is closed.
- The owner's Stop button ends every running turn in the room at once, drops the turns still waiting for a computer, and posts a note; nobody answers until the owner writes again.

## Conversations between understudies

Outside rooms, an understudy reaches a teammate with `message_agent` (a chat turn marked as coming from a teammate) or `hand_off` (starts one of the teammate's tasks; every step still needs its own owner's approval). Each one is kept in `agent_messages`, and the panel's Conversations page shows every pair as a thread next to the owner's rooms.

- No depth or hourly limit applies by default. `UNDERSTUDY_AGENT_TALK_CEILING`, when set, is the most turns in a row understudies may take among themselves, in rooms and between pairs.
- Stop on a pair thread records a `stop` line in `agent_messages`, drops their queued messages to each other, and refuses `message_agent` and `hand_off` between the two until the owner lets them talk again (a `resume` line).
- A teammate's word never approves an irreversible step; that stays with each understudy's own owner.

## Files in the chat

The owner attaches files in the chat (paperclip, drag and drop, paste). The browser streams each one in 8 MB chunks to `/api/files/<agent>/uploads` on the panel, which passes every chunk to the computer over its socket (`upload_open`, `upload_chunk`, `upload_finish`) and answers only after the computer wrote it, so nothing is staged on the panel. A failed chunk is retried from the byte count the computer reports; the computer refuses an upload that does not fit on its disk before any byte moves. The limit is `UNDERSTUDY_UPLOAD_MAX_BYTES` (4 GB by default). Finished files land in `~/files/inbox` under a sanitized, unique name, and the message the brain receives lists each one with its full path, type and size.

The brain sends files back with the gatekeeper tool `share_file`: the computer copies the file into `~/files/outbox` when it lives elsewhere in the home folder (never from hidden folders) and the panel posts it in the chat. Every file in a message renders as a card with a preview. Downloads and previews stream from `/api/files/<agent>/raw` with byte ranges (`file_read`), and PDF first pages and video posters come from `/thumb`.

Only the owner uploads. The owner can read anything in the inbox and outbox; approvers and viewers can read only files that were posted in that understudy's chat. Files are served with `nosniff`, a sandboxing Content-Security-Policy, and as downloads unless they are images, video, audio or PDF; HTML and SVG are never rendered.

## Artifacts

An artifact is something the understudy made for people to look at (a deck, a document, a page, a chart, a small app, a PDF, an image), with a title and a list of immutable versions. The brain publishes one with the gatekeeper tool `publish_artifact` (path, title, optional `artifact_id` to add a version, optional note). The panel takes a snapshot on the spot: it reads the file over the computer socket (`file_share`, `file_read`), and for PDF and office files asks the computer to render page images (`artifact_render`, `artifact_page`; LibreOffice converts, poppler rasterizes, up to 60 pages). Metadata lives in Postgres (`artifacts`, `artifact_versions`, `artifact_links`); bytes and pages go to an S3-compatible bucket under a key per version id, or to `artifact_blobs` in Postgres when no bucket is set. Each version keeps its own kind, and an understudy's artifacts are capped in total (`UNDERSTUDY_ARTIFACT_AGENT_MAX_BYTES`). A version opens even while the computer sleeps.

The card lands in the chat and opens beside it in the Artifacts tab: versions, zoom, pages, full screen, download. "Request edits" sends a normal chat message with a structured reference (artifact, version, the selected text or the page). The panel first writes that exact version back into `~/files/inbox/artifacts/<id>/v<n>/` with `file_put`, and the computer briefs the brain with the path, the quote marked as data, and the instruction to publish again with the same `artifact_id`.

Rendered content never runs with the panel's origin:

- HTML loads in an iframe with `sandbox="allow-scripts"` (no `allow-same-origin`, popups, forms or top navigation), and the response itself carries `Content-Security-Policy: sandbox allow-scripts` so it stays sandboxed when opened directly. The same policy closes the network: `connect-src`, `form-action`, `frame-src`, `worker-src` are `'none'`, images and media only `data:`/`blob:`, scripts and styles inline or from cdnjs, jsdelivr and unpkg, fonts also from Google Fonts. `frame-ancestors` is the panel only, and the panel sends `frame-src <content origin>/api/artifacts/c/`, so an artifact that tries to navigate its frame elsewhere (to leak its content or show a fake sign-in) is blocked.
- Content URLs carry a signed token (HMAC, one version, one hour) instead of the session cookie, so the content route works the same on a separate origin (`UNDERSTUDY_ARTIFACT_ORIGIN`).
- The panel prepends a short script to HTML that only reports the selected text and blocked requests with `postMessage`. The panel accepts messages only from that iframe's window, checks their shape and size, and treats them as data. The quote reaches the brain as a JSON string on one line, so a crafted selection cannot close it and pose as the owner.
- The content route is rate limited per client and version and sends an `ETag` with `immutable` caching, since a version never changes.
- Markdown renders with the chat's own renderer (no raw HTML, no remote images); PDF and office files are page images; SVG only as an image with a script-free policy; downloads are `application/octet-stream` attachments.
- What is left: an interactive artifact can still leak its own content through channels a CSP does not close (WebRTC, DNS prefetch, a CDN script URL). It cannot read anything outside itself.

The owner can create a public link for the version on screen (`/shared/<token>`): the token is random, only its hash is stored, it expires after 30 days and every link can be turned off. The link always shows that version, never a later one, so an injected agent cannot push new content through a link someone already has. The page has no panel controls, hides the artifact id, uses content tokens that last ten minutes, and stays sandboxed.
