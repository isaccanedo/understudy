#!/usr/bin/env bash
set -euo pipefail
registry="$1"
prefix="$2"
region="$3"
server_url="$4"
tag="${5:-latest}"
host_id="${6:-${prefix}-host-1}"
export HOME=/root
host_image="$registry/${prefix}-host:$tag"
computer_image="$registry/${prefix}-computer:$tag"
computer_latest="$registry/${prefix}-computer:latest"
token=$(aws ssm get-parameter --region "$region" --name "/${prefix}/host/token" --with-decryption --query Parameter.Value --output text)
docker pull "$computer_image"
docker pull "$host_image"
docker tag "$computer_image" "$computer_latest"
capacity=$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "${prefix}-host" 2>/dev/null | sed -n 's/^UNDERSTUDY_HOST_CAPACITY=//p' || true)
capacity="${7:-$capacity}"
docker rm -f "${prefix}-host" >/dev/null 2>&1 || true
docker run -d \
  --name "${prefix}-host" \
  --restart unless-stopped \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -e UNDERSTUDY_HOST_TOKEN="$token" \
  -e UNDERSTUDY_SERVER_URL="$server_url" \
  -e UNDERSTUDY_COMPUTER_IMAGE="$computer_latest" \
  -e UNDERSTUDY_HOST_ID="$host_id" \
  -e UNDERSTUDY_HOST_CAPACITY="$capacity" \
  "$host_image" >/dev/null
docker image prune -f >/dev/null
docker ps --filter "name=${prefix}-host" --format '{{.Names}} {{.Image}} {{.Status}}'
