# Understudy and the persistent-agent products

How Understudy compares with the four products that shaped the idea, and what is still missing. Understudy's column reflects the code on `main` on 7 Oct 2026 (apps/web, apps/computer, apps/host). The other columns reflect public launch material, linked at the end. "Not stated" means the sources do not say, not that the feature is absent.

Legend for Understudy: **has** = works end to end today, **partial** = some of it exists, **missing** = not built.

## Feature table

| Feature | Grok Bot (xAI) | dots (OpenAI) | Muse (Meta) | Akai (Deel) | Understudy |
|---|---|---|---|---|---|
| Named, persistent agent with its own identity (name, avatar, role) | yes: name, avatar, title | yes: specialist dots get an org identity | yes: avatar, realtime video avatar coming | agents per workflow | **has**: name, role, generated character |
| Several agents per person | yes | one included, more for orgs | one personal agent | yes, as many as the work needs | **has** |
| Memory that carries across sessions and learns preferences | yes | yes | yes | yes: playbooks and case history | **has**: profile, notes, journal, recipes on the agent's volume |
| Owner can see and edit the memory | not stated | not stated | can see it (identity area) | not stated | **has**: Memory tab; profile and notes editable, journal and recipes read-only |
| Keeps context small: fresh session per task with a briefing | not stated | not stated | not stated | not stated | **has**: profile + recipe + last 7 journal lines; one chat session per day |
| Own cloud computer with a browser | yes, shared by all of a person's bots | yes, per dot | yes, a VM per user | works through web portals | **has**: one container per agent with a full desktop (Chromium, LibreOffice) and a separate workbench machine for the shell |
| Isolation between agents | bots of one account share a computer | separate from the employee's machine | "no other agent can reach it" | not stated | **has**: container per agent, isolated network, no inbound traffic |
| Live view of what the agent is doing | yes: indicator, pinned preview, full screen | yes: Activity View | not stated | not stated | **has**: the whole desktop live in the panel, about 5 fps, plus a terminal tab and a list of background jobs |
| Take over the agent's computer and hand it back | yes | can intervene | not stated | not stated | **has**: take and release control |
| Work beyond the browser: office files, data, scripts | yes | yes: Pages, slides, sheets | not stated | not stated | **has**: LibreOffice, Python with pandas, pdfplumber and DuckDB, OCR, pandoc, ffmpeg, ImageMagick, vips, graphviz and HyperFrames, with Blender, GIMP and Inkscape on demand; long work runs as background jobs the owner can see and stop |
| Reusable skills the agent writes for itself | yes: skills | not stated | not stated | not stated | **has**: saved skills (a README and scripts) listed in every briefing and visible in the Memory tab |
| Sub-agents for big jobs | not stated | not stated | not stated | yes | **has**: Claude's sub-agents under the same rules and limits |
| Learn a task by watching it done once | yes: walk it through once, saved as a skill | no | no | yes: one screen recording with a spoken walkthrough | **has**: recording with voice or text narration, turned into an editable recipe |
| Create a reusable task from a plain-language description | yes: skills | yes: goals | yes: goals | yes | **has**: "describe it" on the teach screen; the brain writes the recipe and may look at the sites read-only |
| Agent asks clarifying questions about the task | not stated | not stated | not stated | yes: asks instead of rejecting edge cases | **has**: recipe questions with options, answered in the editor |
| Scheduled routines | yes | yes | goals over time | yes, on business cycles | **has**: cron with timezone, pause and resume |
| Run on demand | yes | yes | yes | yes | **has**: Run now with optional input, plus test runs |
| Event triggers (new email, webhook, app event, watch a page) | yes: routines on events, watching | yes: background monitoring | yes: forwarded email | not stated | **has**: per-recipe webhook with a secret URL, an inbound email address per task, and watching a page (or one part of it) that starts the task with what changed |
| Approval before irreversible actions | yes | yes | yes: before sending or buying | yes, on by default | **has**: enforced by the computer at the browser-tool layer (submits and pay/send/delete-like controls pause for the owner), first runs and webhook runs always ask, waits up to 24 h |
| Rules for what is allowed, needs approval, or is forbidden | not stated | yes: Custom Rules | not stated | governance controls | **has**: per-step ask, ask-always, first-runs, admin-forced approvals per MCP tool, and owner rules (maximum amount, allowed email domains, blocked sites, rules in the owner's words) that the computer and the gatekeeper block on their own |
| Automatic check of consequential actions against instructions | not stated | yes: auto-review | not stated | not stated | **has**: the computer inspects the real element before every click or Enter and asks when it would commit, flagging actions that are not a recipe step |
| Talk to the agent from Slack, Teams, SMS or phone | not stated | yes: Slack, Teams, audio; SMS coming | voice on glasses | not stated | **has**: Slack DMs and mentions reach the agent and it answers in the thread |
| Approve from a chat app | not stated | through Slack and Teams | not stated | not stated | **has**: approve or deny from Slack |
| Agent has its own email address | not stated | not stated | yes | not stated | **missing** |
| Connectors to business apps | yes, plus computer use for the rest | 4,000+ apps | Gmail, calendar, Meta apps, shopping | builds connectors itself | **partial**: browser for everything; admin-registered MCP servers (Slack and others) with who-may-attach and forced approvals |
| Notify the owner proactively | yes | yes | yes: proactive suggestions | surfaces anomalies | **has**: notify_owner, Slack DMs, a daily briefing DM and a Today page |
| Surface anomalies and exceptions in each run | not stated | not stated | not stated | yes, every run | **has**: each run reports unusual things against past runs, shown highlighted on the run page |
| Replayable execution history and audit trail | not stated | Activity View | not stated | yes: every run logged and replayable | **has**: run page with every step, screenshots, approvals and usage; runs list per agent; tool calls logged |
| Several agents working together (group chat, teams of agents) | yes: 2 to 6 bots in a group chat | ChatGPT Space with people | no | yes: agents share context | **has**: agents message each other and hand tasks to each other, shown next to the owner's group rooms in Conversations |
| Share an agent and its work with a team | shared templates, account switching | Space pages with permissions | no | team review | **has**: teammates as approvers or viewers; approvers get approval DMs |
| Files in (upload) and artifacts out (documents, data) | yes | yes: Pages, slides, sheets | not stated | not stated | **has**: upload to the agent's inbox (it is told in chat), list and download its outbox; artifacts open beside the chat with versions, page view, request edits on a selection and public links |
| Credentials vault for sites the agent logs into | Chrome profile import | org credentials | not stated | encrypted vault | **has**: encrypted per agent, site required, filled only into the right field on that site without the secret reaching the brain (claude only) |
| Template gallery to start from | shared templates | not stated | small business skills | not stated | **has**: share a task as a template others install |
| Voice | not stated | audio interface | voice, glasses, video avatar | spoken walkthroughs | **partial**: voice input for chat and narration |
| Mobile | not stated | ChatGPT apps | app | not stated | **partial**: installable web app with push notifications for approvals and blocks |
| Usage and cost visibility | weekly usage limits | not stated | not stated | not stated | **has**: tokens and cost per run, 30-day totals per agent, monthly cost on the home page |
| Runs on the owner's own subscription, open source, self-hosted | no | no | no | no | **has**: Claude Code or Codex login, or an API key |
| Languages | not stated | not stated | not stated | not stated | **has**: English and Brazilian Portuguese panel |

## Gaps, ranked by value for non-technical teams

1. **Codex parity.** The vault and tool denials work only with Claude; codex stays off by default. *Idea:* run codex's shell in the workbench container once user namespaces are available on the host. Touches computer and host.
2. **An email address for the agent itself.** Today a task has an inbound address, but the agent cannot send from its own mailbox. *Idea:* a per-agent mailbox behind the gatekeeper, with the owner's domain rules applied. Touches web.
3. **Voice replies.** Voice goes in, but replies are text. *Idea:* text-to-speech for chat replies on the phone. Touches web.
4. **Rules that read the page, not just the fields.** Amount limits are checked on the fields typed and submitted, not on totals shown elsewhere on the page. *Idea:* scan the confirmation page for currency amounts before a pay-like click. Touches computer.

## Sources

- xAI, [Designing Grok Bot for a world of persistent agents](https://x.ai/news/designing-grok-bot), [Grok Bot docs](https://docs.x.ai/grok-bot/overview), [Grok Bot guides](https://x.ai/bot/guides), [AIBase on templates, account switching and exit routing](https://news.aibase.com/news/30628)
- OpenAI dots: [VentureBeat](https://venturebeat.com/technology/openai-launches-dots-always-on-ai-agent-coworkers-and-chatgpt-space-where-they-can-collaborate-with-human-teams), [TechCrunch](https://techcrunch.com/2026/09/29/openai-launches-dots-its-bubbly-agentic-avatar/), [TechRadar](https://www.techradar.com/pro/openai-launches-dots-its-always-on-ai-agents-that-are-always-watching)
- Meta Muse: [TechCrunch, everything new coming to Muse](https://techcrunch.com/2026/09/23/everything-new-coming-to-metas-ai-agent-muse/), [MindStudio explainer](https://www.mindstudio.ai/blog/meta-muse-ai-agent), [PBS](https://www.pbs.org/newshour/nation/meta-launches-personal-ai-agent-muse-to-help-with-everyday-tasks)
- Deel Akai: [Deel blog](https://www.deel.com/blog/akai-by-deel/), [CPA Practice Advisor](https://www.cpapracticeadvisor.com/2026/05/12/deel-launches-agentic-workflow-platform-akai/183249/), [ITBrief](https://itbrief.co.uk/story/deel-launches-akai-to-automate-back-office-workflows)
