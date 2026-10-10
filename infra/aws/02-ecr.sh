#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/../lib.sh"

for app in $ECR_APPS; do
  repo="${NAME_PREFIX}-${app}"
  if aws ecr describe-repositories --repository-names "$repo" >/dev/null 2>&1; then
    echo "ecr $repo exists"
    continue
  fi
  aws ecr create-repository --repository-name "$repo" --image-scanning-configuration scanOnPush=true --encryption-configuration encryptionType=AES256 --tags "$TAGS_SPEC" --query repository.repositoryUri --output text
  aws ecr put-lifecycle-policy --repository-name "$repo" --lifecycle-policy-text '{"rules":[{"rulePriority":1,"description":"keep last 30 images","selection":{"tagStatus":"any","countType":"imageCountMoreThan","countNumber":30},"action":{"type":"expire"}}]}' >/dev/null
done
