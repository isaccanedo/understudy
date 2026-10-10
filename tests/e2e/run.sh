#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
compose=(docker compose -p understudy-e2e --env-file "$here/e2e.env" -f "$root/docker-compose.yml" -f "$here/docker-compose.e2e.yml")
network="understudy-e2e-agents"

cleanup() {
  if [ "${E2E_KEEP:-0}" = "1" ]; then
    echo "E2E_KEEP=1: leaving the stack up"
    return
  fi
  echo "tearing down"
  agents=$(docker ps -aq --filter "network=$network" || true)
  if [ -n "$agents" ]; then
    for id in $(docker inspect --format '{{index .Config.Labels "understudy.agent"}}' $agents); do
      docker rm -f "agent-$id" "bench-$id" >/dev/null 2>&1 || true
      docker volume rm "agent-$id-home" "agent-$id-bench" >/dev/null 2>&1 || true
    done
  fi
  "${compose[@]}" --profile build down -v --remove-orphans >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
}
trap cleanup EXIT

if [ "${E2E_SKIP_BUILD:-0}" != "1" ]; then
  echo "building images"
  "${compose[@]}" --profile build build computer web host
fi

echo "starting the stack"
"${compose[@]}" up -d postgres web host site

echo "waiting for the panel"
for _ in $(seq 1 90); do
  if curl -fsS http://127.0.0.1:39100/api/health >/dev/null 2>&1; then break; fi
  sleep 2
done
curl -fsS http://127.0.0.1:39100/api/health >/dev/null

cd "$here"
if [ ! -d node_modules ]; then npm install --no-audit --no-fund; fi
npx playwright install chromium >/dev/null
npx playwright test "$@" || {
  status=$?
  echo "--- web logs"; "${compose[@]}" logs --tail 80 web || true
  echo "--- host logs"; "${compose[@]}" logs --tail 80 host || true
  for container in $(docker ps -aq --filter "network=$network"); do
    echo "--- computer $(docker inspect --format '{{.Name}}' "$container")"; docker logs --tail 80 "$container" 2>&1 || true
  done
  exit $status
}

agent=$(docker ps -q --filter "name=^agent-" --filter "network=$network" | head -1)
if [ -n "$agent" ]; then
  echo "--- isolation checks inside $(docker inspect --format '{{.Name}}' "$agent")"
  docker exec -w /app/apps/computer "$agent" node --experimental-strip-types --no-warnings dev/isolation-check.ts
  docker exec -w /app/apps/computer "$agent" node --experimental-strip-types --no-warnings dev/workbench-check.ts
fi
