#!/usr/bin/env bash
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../../.." && pwd)"
compose=(docker compose -p understudy-demo --env-file "$here/demo.env" -f "$root/docker-compose.yml" -f "$here/docker-compose.demo.yml")
network="understudy-demo-agents"

cleanup() {
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
cleanup

"${compose[@]}" --profile build build computer web host
"${compose[@]}" up -d postgres web host site
for _ in $(seq 1 90); do
  if curl -fsS http://127.0.0.1:39200/api/health >/dev/null 2>&1; then break; fi
  sleep 2
done

cd "$here/.."
if [ ! -d node_modules ]; then npm install --no-audit --no-fund; fi
npx playwright install chromium >/dev/null
spec="${DEMO_SPEC:-demo.spec.ts}"
out="${DEMO_OUT:-understudy-demo.mp4}"
E2E_BASE_URL=http://host.docker.internal:39200 E2E_SITE_URL=http://host.docker.internal:39201/ npx playwright test -c demo.config.ts "$spec"
if [ "$spec" != "screenshots.spec.ts" ]; then
  bash "$here/make-video.sh" "" "$here/../demo-results/$out"
fi
