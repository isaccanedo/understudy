#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/../lib.sh"
require PUBLIC_HOST ALLOWED_EMAIL_DOMAIN
secret="${NAME_PREFIX}-env"

existing() {
  kubectl -n "$K8S_NAMESPACE" get secret "$secret" -o "jsonpath={.data.$1}" 2>/dev/null | base64 -d 2>/dev/null || true
}

random_token() {
  openssl rand -hex 32
}

db=$(aws rds describe-db-instances --db-instance-identifier "$DB_IDENTIFIER" --query 'DBInstances[0].[Endpoint.Address,MasterUserSecret.SecretArn]' --output text)
db_host=$(cut -f1 <<<"$db")
db_secret_arn=$(cut -f2 <<<"$db")
db_pass=$(aws secretsmanager get-secret-value --secret-id "$db_secret_arn" --query SecretString --output text | python3 -c 'import json,sys,urllib.parse;print(urllib.parse.quote(json.load(sys.stdin)["password"],safe=""))')
database_url="postgresql://${DB_USER}:${db_pass}@${db_host}:5432/${DB_NAME}?sslmode=verify-full"

inbound_topic_arn=""
inbound_bucket=""
if [ -n "${INBOUND_EMAIL_DOMAIN:-}" ]; then
  inbound_topic_arn="arn:aws:sns:${AWS_REGION}:${AWS_ACCOUNT_ID}:${NAME_PREFIX}-inbound-email"
  inbound_bucket="${INBOUND_EMAIL_BUCKET:-${NAME_PREFIX}-inbound-email-${AWS_ACCOUNT_ID}}"
fi

auth_secret=$(existing BETTER_AUTH_SECRET); [ -n "$auth_secret" ] || auth_secret=$(random_token)
host_token=$(existing UNDERSTUDY_HOST_TOKEN); [ -n "$host_token" ] || host_token=$(random_token)
admin_emails="${ADMIN_EMAILS:-$(existing UNDERSTUDY_ADMIN_EMAILS)}"
slack_token="${SLACK_BOT_TOKEN:-$(existing SLACK_BOT_TOKEN)}"

kubectl -n "$K8S_NAMESPACE" create secret generic "$secret" \
  --from-literal=DATABASE_URL="$database_url" \
  --from-literal=BETTER_AUTH_SECRET="$auth_secret" \
  --from-literal=UNDERSTUDY_HOST_TOKEN="$host_token" \
  --from-literal=UNDERSTUDY_PUBLIC_URL="https://${PUBLIC_HOST}" \
  --from-literal=UNDERSTUDY_ALLOWED_EMAIL_DOMAIN="$ALLOWED_EMAIL_DOMAIN" \
  --from-literal=UNDERSTUDY_ADMIN_EMAILS="$admin_emails" \
  --from-literal=SLACK_BOT_TOKEN="$slack_token" \
  --from-literal=UNDERSTUDY_TIMEZONE="${TIMEZONE:-UTC}" \
  --from-literal=UNDERSTUDY_HOST_IDS="${HOST_IDS:-${HOST_ID:-${NAME_PREFIX}-host-1}}" \
  --from-literal=UNDERSTUDY_BLOCKED_CIDRS="${BLOCKED_CIDRS:-}" \
  --from-literal=UNDERSTUDY_INBOUND_EMAIL_DOMAIN="${INBOUND_EMAIL_DOMAIN:-}" \
  --from-literal=UNDERSTUDY_INBOUND_SNS_TOPIC_ARN="${inbound_topic_arn}" \
  --from-literal=UNDERSTUDY_INBOUND_S3_BUCKET="${inbound_bucket}" \
  --dry-run=client -o yaml | kubectl apply -f - >/dev/null
kubectl -n "$K8S_NAMESPACE" label secret "$secret" "project=${NAME_PREFIX}" --overwrite >/dev/null

aws ssm put-parameter --name "$HOST_TOKEN_PARAM" --type SecureString --overwrite --value "$host_token" >/dev/null
aws ssm add-tags-to-resource --resource-type Parameter --resource-id "$HOST_TOKEN_PARAM" --tags "$TAGS_SPEC"
echo "secret $secret applied, host token stored in $HOST_TOKEN_PARAM"
