#!/usr/bin/env bash
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
source "$here/../lib.sh"
require PUBLIC_HOST
tag="${1:-latest}"
registry="${ECR_REGISTRY:-$(ecr_registry)}"

instance_id=$(aws ec2 describe-instances --filters "Name=tag:Name,Values=$HOST_NAME" "Name=tag:Project,Values=$PROJECT_TAG" "Name=instance-state-name,Values=running" --query 'Reservations[0].Instances[0].InstanceId' --output text)
if [ "$instance_id" = "None" ] || [ -z "$instance_id" ]; then
  echo "no running instance tagged Name=$HOST_NAME" >&2
  exit 1
fi

script_b64=$(base64 < "$here/run-on-host.sh" | tr -d '\n')
params=$(python3 -c 'import json,shlex,sys
b64,args=sys.argv[1],sys.argv[2:]
print(json.dumps({"commands":[
  "echo %s | base64 -d > /usr/local/bin/understudy-run-host && chmod +x /usr/local/bin/understudy-run-host" % b64,
  "/usr/local/bin/understudy-run-host " + " ".join(shlex.quote(a) for a in args)
]}))' "$script_b64" "$registry" "$NAME_PREFIX" "$AWS_REGION" "https://${PUBLIC_HOST}" "$tag" "${HOST_ID:-${NAME_PREFIX}-host-1}")

command_id=$(aws ssm send-command --instance-ids "$instance_id" --document-name AWS-RunShellScript --comment "host deploy $tag" --parameters "$params" --query Command.CommandId --output text)
status=Pending
for _ in $(seq 1 90); do
  status=$(aws ssm get-command-invocation --command-id "$command_id" --instance-id "$instance_id" --query Status --output text 2>/dev/null || echo Pending)
  case "$status" in
    Success|Failed|Cancelled|TimedOut) break ;;
  esac
  sleep 5
done
aws ssm get-command-invocation --command-id "$command_id" --instance-id "$instance_id" --query '[Status,StandardOutputContent,StandardErrorContent]' --output text
[ "$status" = "Success" ]
