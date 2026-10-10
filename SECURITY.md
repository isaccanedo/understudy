# Security policy

Understudy runs AI agents with their own browser, logged into their owners' subscriptions and the sites they work on. We take reports about it seriously.

## Reporting a vulnerability

Please report privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**. This opens a private security advisory that only the maintainers can see.

Do not open a public issue, pull request or discussion for a security problem.

Include what you can of:

- the component (`apps/web`, `apps/computer`, `apps/host`, `infra`) and the version or commit;
- what an attacker can do and what they need first (an account, a malicious web page, access to the host network);
- steps or a proof of concept.

We will acknowledge the report within three working days, keep you updated while we fix it, and credit you in the advisory unless you prefer otherwise.

## Scope

In scope, among others:

- escaping a computer container, or one agent reaching another agent, the host or the panel's internal network;
- reading another user's agents, recordings, memory or approvals;
- making an agent take an irreversible step without its owner's approval, including through content on a web page (prompt injection);
- leaking subscription logins, recorded passwords or other masked values;
- authentication or authorization flaws in the panel, the host socket, the computer socket or the gatekeeper MCP.

Out of scope: problems that need a malicious administrator of the deployment, denial of service by volume, and missing hardening headers without a concrete impact.

## Supported versions

Only the latest commit on `main` receives fixes.
