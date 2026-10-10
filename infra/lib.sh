infra_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
config_file="${UNDERSTUDY_INFRA_CONFIG:-$infra_dir/config.env}"
if [ -f "$config_file" ]; then
  set -a
  source "$config_file"
  set +a
fi

require() {
  for name in "$@"; do
    if [ -z "${!name:-}" ]; then
      echo "missing $name: set it in $config_file or the environment" >&2
      exit 1
    fi
  done
}

require NAME_PREFIX AWS_REGION
export AWS_REGION AWS_DEFAULT_REGION="$AWS_REGION"
export PROJECT_TAG="$NAME_PREFIX"
export K8S_NAMESPACE="${K8S_NAMESPACE:-$NAME_PREFIX}"
export HOST_NAME="${NAME_PREFIX}-host"
export HOST_ROLE="${NAME_PREFIX}-host"
export DEPLOY_ROLE="github-actions-${NAME_PREFIX}-deploy"
export DB_IDENTIFIER="${DB_IDENTIFIER:-${NAME_PREFIX}-db}"
export DB_NAME="${DB_NAME:-$NAME_PREFIX}"
export DB_USER="${DB_USER:-$NAME_PREFIX}"
export DB_SUBNET_GROUP="${DB_SUBNET_GROUP:-${NAME_PREFIX}-db}"
export DB_SECURITY_GROUP="${DB_SECURITY_GROUP:-${NAME_PREFIX}-rds-sg}"
export HOST_TOKEN_PARAM="/${NAME_PREFIX}/host/token"
export ECR_APPS="web computer host"
export TAGS_SPEC="Key=Project,Value=${PROJECT_TAG}"

tag_spec() {
  printf 'ResourceType=%s,Tags=[{Key=Project,Value=%s},{Key=Name,Value=%s}]' "$1" "$PROJECT_TAG" "$2"
}

find_tagged() {
  local value
  value=$(aws ec2 "describe-$1" --filters "Name=tag:Name,Values=$2" "Name=tag:Project,Values=${PROJECT_TAG}" --query "$3" --output text)
  [ "$value" = "None" ] && value=""
  printf '%s' "$value"
}

ecr_registry() {
  require AWS_ACCOUNT_ID
  printf '%s.dkr.ecr.%s.amazonaws.com' "$AWS_ACCOUNT_ID" "$AWS_REGION"
}
