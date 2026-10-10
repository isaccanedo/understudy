# Understudy host

The host supervisor runs on a machine with Docker and keeps one computer container per agent. It dials the panel at `UNDERSTUDY_SERVER_URL/api/ws/host`, announces itself with `host_hello`, and answers `computer_ensure`, `computer_stop` and `computer_destroy` through the Docker Engine API on the mounted socket, reporting every change as `computer_status`.

## Environment

| Variable | Required | Meaning |
|---|---|---|
| `UNDERSTUDY_SERVER_URL` | yes | Panel base URL |
| `UNDERSTUDY_HOST_TOKEN` | yes | Bearer token for the host socket |
| `UNDERSTUDY_COMPUTER_IMAGE` | recommended | The only computer image this host runs; `computer_ensure` asking for another image is refused |
| `UNDERSTUDY_HOST_ID` | no | Name reported to the panel (default: hostname) |
| `UNDERSTUDY_HOST_CAPACITY` | no | Maximum computers running at once (default: one per 2 GB of memory, leaving 2 GB) |
| `UNDERSTUDY_COMPUTER_NETWORK` | no | Docker network for computers (default `understudy-agents`, created with inter-container traffic disabled) |
| `UNDERSTUDY_COMPUTER_ENV` | no | Comma-separated names of host variables to forward to every computer, for API-key mode (for example `ANTHROPIC_BASE_URL,ANTHROPIC_AUTH_TOKEN`) |
| `UNDERSTUDY_COMPUTER_EXTRA_HOSTS` | no | Comma-separated `name:ip` or `name:host-gateway` added to every computer's `/etc/hosts`, for example `host.docker.internal:host-gateway` when the panel runs on the same Linux machine |
| `UNDERSTUDY_VERSION` | no | Build id reported in `host_hello.build` (set by the Docker build arg of the same name) |
| `UNDERSTUDY_ALWAYS_PULL` | no | `1` pulls the image on every ensure |
| `UNDERSTUDY_REGISTRY_AUTH` or `UNDERSTUDY_REGISTRY_PASSWORD_COMMAND` + `UNDERSTUDY_REGISTRY_SERVER` | no | Registry credentials when the host must pull by itself |
| `DOCKER_SOCKET` | no | Default `/var/run/docker.sock` |

The image is normally pulled on the machine before the host starts. The host only pulls when the image is missing, and after a new image lands it recreates an agent's container on the next `computer_ensure`, keeping its volume.

## What each computer gets

- Container `agent-<id>`, volume `agent-<id>-home` mounted at `/home/agent`.
- Env `AGENT_ID`, `AGENT_TOKEN`, `UNDERSTUDY_SERVER_URL`, plus the names in `UNDERSTUDY_COMPUTER_ENV`.
- 2 GB memory (no swap), 1 CPU, 1 GB `/dev/shm`, 2048 pids, restart `unless-stopped`, `--init`, rotated logs.
- Never privileged, all capabilities dropped, `no-new-privileges`, never the host network.

A changed token or image recreates the container; the volume (browser logins, memory, subscription login) survives. `computer_destroy` removes both.

## Run it locally

```sh
cd apps/host
npm install
node --experimental-strip-types --no-warnings --test src/*.test.ts
```

With the mock panel from `apps/computer` running:

```sh
docker build -f apps/host/Dockerfile -t understudy-host:dev .
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
  -e UNDERSTUDY_SERVER_URL=http://host.docker.internal:8787 \
  -e UNDERSTUDY_HOST_TOKEN=dev-host-token \
  -e UNDERSTUDY_COMPUTER_IMAGE=understudy-computer:dev \
  understudy-host:dev
```

Then type `ensure <agentId> understudy-computer:dev http://host.docker.internal:8787 dev-token` in the mock's terminal, and `destroy <agentId>` to clean up.

## Security model

- The host needs the Docker socket, which is root on the machine: run it only on a machine dedicated to agents, in a network with no route to anything internal.
- Computers run on a bridge network with inter-container communication disabled, so one agent cannot reach another; the host refuses `host`, `bridge`, `none` and shared-namespace networks, and refuses an existing network that allows inter-container traffic.
- Only the configured image runs, and only up to the configured capacity, even when the panel asks for more.
- On cloud machines, keep the instance metadata service out of reach of containers (on AWS: IMDSv2 required with hop limit 1).
