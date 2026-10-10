#!/usr/bin/env bash
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
source "$here/../lib.sh"
require AWS_ACCOUNT_ID INBOUND_EMAIL_DOMAIN PUBLIC_HOST EKS_CLUSTER

bucket="${INBOUND_EMAIL_BUCKET:-${NAME_PREFIX}-inbound-email-${AWS_ACCOUNT_ID}}"
topic_name="${NAME_PREFIX}-inbound-email"
rule_set="${NAME_PREFIX}-inbound"
rule_name="${NAME_PREFIX}-to-panel"
web_role="${NAME_PREFIX}-web"
endpoint="https://${PUBLIC_HOST}/api/inbound/email"

if ! aws s3api head-bucket --bucket "$bucket" >/dev/null 2>&1; then
  if [ "$AWS_REGION" = "us-east-1" ]; then
    aws s3api create-bucket --bucket "$bucket" >/dev/null
  else
    aws s3api create-bucket --bucket "$bucket" --create-bucket-configuration "LocationConstraint=$AWS_REGION" >/dev/null
  fi
fi
aws s3api put-public-access-block --bucket "$bucket" --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-encryption --bucket "$bucket" --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"},"BucketKeyEnabled":true}]}'
aws s3api put-bucket-lifecycle-configuration --bucket "$bucket" --lifecycle-configuration "{\"Rules\":[{\"ID\":\"expire-after-${INBOUND_EMAIL_RETENTION_DAYS:-30}-days\",\"Status\":\"Enabled\",\"Filter\":{},\"Expiration\":{\"Days\":${INBOUND_EMAIL_RETENTION_DAYS:-30}},\"AbortIncompleteMultipartUpload\":{\"DaysAfterInitiation\":1}}]}"
aws s3api put-bucket-tagging --bucket "$bucket" --tagging "TagSet=[{Key=Project,Value=${PROJECT_TAG}}]"
aws s3api put-bucket-policy --bucket "$bucket" --policy "$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowSesPut",
      "Effect": "Allow",
      "Principal": {"Service": "ses.amazonaws.com"},
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::${bucket}/raw/*",
      "Condition": {
        "StringEquals": {"aws:SourceAccount": "${AWS_ACCOUNT_ID}"},
        "ArnLike": {"aws:SourceArn": "arn:aws:ses:${AWS_REGION}:${AWS_ACCOUNT_ID}:receipt-rule-set/${rule_set}:receipt-rule/${rule_name}"}
      }
    },
    {
      "Sid": "DenyInsecureTransport",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:*",
      "Resource": ["arn:aws:s3:::${bucket}", "arn:aws:s3:::${bucket}/*"],
      "Condition": {"Bool": {"aws:SecureTransport": "false"}}
    }
  ]
}
JSON
)"
echo "bucket $bucket"

topic_arn=$(aws sns create-topic --name "$topic_name" --tags "$TAGS_SPEC" --query TopicArn --output text)
aws sns set-topic-attributes --topic-arn "$topic_arn" --attribute-name Policy --attribute-value "$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowSesPublish",
      "Effect": "Allow",
      "Principal": {"Service": "ses.amazonaws.com"},
      "Action": "sns:Publish",
      "Resource": "${topic_arn}",
      "Condition": {
        "StringEquals": {"aws:SourceAccount": "${AWS_ACCOUNT_ID}"},
        "ArnLike": {"aws:SourceArn": "arn:aws:ses:${AWS_REGION}:${AWS_ACCOUNT_ID}:receipt-rule-set/${rule_set}:receipt-rule/${rule_name}"}
      }
    }
  ]
}
JSON
)"
echo "topic $topic_arn"

if ! aws sesv2 get-email-identity --email-identity "$INBOUND_EMAIL_DOMAIN" >/dev/null 2>&1; then
  aws sesv2 create-email-identity --email-identity "$INBOUND_EMAIL_DOMAIN" --tags "Key=Project,Value=${PROJECT_TAG}" >/dev/null
fi
dkim_tokens=$(aws sesv2 get-email-identity --email-identity "$INBOUND_EMAIL_DOMAIN" --query 'DkimAttributes.Tokens' --output text)

records=("MX ${INBOUND_EMAIL_DOMAIN} inbound-smtp.${AWS_REGION}.amazonaws.com 10")
for token in $dkim_tokens; do
  records+=("CNAME ${token}._domainkey.${INBOUND_EMAIL_DOMAIN} ${token}.dkim.amazonses.com 0")
done

if [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then
  require CLOUDFLARE_ZONE_NAME
  cf() {
    curl -fsS -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" -H "Content-Type: application/json" "$@"
  }
  zone_id=$(cf "https://api.cloudflare.com/client/v4/zones?name=${CLOUDFLARE_ZONE_NAME}" | python3 -c 'import json,sys;print(json.load(sys.stdin)["result"][0]["id"])')
  for record in "${records[@]}"; do
    read -r type name content priority <<<"$record"
    existing=$(cf "https://api.cloudflare.com/client/v4/zones/${zone_id}/dns_records?type=${type}&name=${name}" | python3 -c 'import json,sys;print(len(json.load(sys.stdin)["result"]))')
    if [ "$existing" = "0" ]; then
      body=$(python3 -c 'import json,sys;t,n,c,p=sys.argv[1:];d={"type":t,"name":n,"content":c,"ttl":300,"proxied":False};d.update({"priority":int(p)} if t=="MX" else {});print(json.dumps(d))' "$type" "$name" "$content" "$priority")
      cf -X POST "https://api.cloudflare.com/client/v4/zones/${zone_id}/dns_records" --data "$body" >/dev/null
      echo "dns created $type $name"
    else
      echo "dns exists $type $name"
    fi
  done
else
  echo "create these DNS records at your DNS provider:"
  printf '  %s\n' "${records[@]}"
fi

if ! aws ses describe-receipt-rule-set --rule-set-name "$rule_set" >/dev/null 2>&1; then
  aws ses create-receipt-rule-set --rule-set-name "$rule_set"
fi
if ! aws ses describe-receipt-rule --rule-set-name "$rule_set" --rule-name "$rule_name" >/dev/null 2>&1; then
  for _ in 1 2 3 4 5 6; do
    if aws ses create-receipt-rule --rule-set-name "$rule_set" --rule "$(cat <<JSON
{
  "Name": "${rule_name}",
  "Enabled": true,
  "TlsPolicy": "Optional",
  "ScanEnabled": true,
  "Recipients": ["${INBOUND_EMAIL_DOMAIN}"],
  "Actions": [{"S3Action": {"BucketName": "${bucket}", "ObjectKeyPrefix": "raw/", "TopicArn": "${topic_arn}"}}]
}
JSON
)" 2>/dev/null; then
      break
    fi
    sleep 10
  done
fi
active=$(aws ses describe-active-receipt-rule-set --query 'Metadata.Name' --output text 2>/dev/null || true)
if [ -z "$active" ] || [ "$active" = "None" ]; then
  aws ses set-active-receipt-rule-set --rule-set-name "$rule_set"
  echo "rule set $rule_set active"
elif [ "$active" != "$rule_set" ]; then
  echo "another receipt rule set ($active) is active in $AWS_REGION; add the rule $rule_name to it by hand" >&2
fi

oidc=$(aws eks describe-cluster --name "$EKS_CLUSTER" --query 'cluster.identity.oidc.issuer' --output text | sed 's|^https://||')
trust=$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {"Federated": "arn:aws:iam::${AWS_ACCOUNT_ID}:oidc-provider/${oidc}"},
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {"StringEquals": {"${oidc}:sub": "system:serviceaccount:${K8S_NAMESPACE}:${NAME_PREFIX}-web", "${oidc}:aud": "sts.amazonaws.com"}}
    }
  ]
}
JSON
)
if ! aws iam get-role --role-name "$web_role" >/dev/null 2>&1; then
  aws iam create-role --role-name "$web_role" --tags "$TAGS_SPEC" --assume-role-policy-document "$trust" >/dev/null
else
  aws iam update-assume-role-policy --role-name "$web_role" --policy-document "$trust"
fi
aws iam put-role-policy --role-name "$web_role" --policy-name "${NAME_PREFIX}-inbound-email-read" --policy-document "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":\"s3:GetObject\",\"Resource\":\"arn:aws:s3:::${bucket}/raw/*\"}]}"
web_role_arn=$(aws iam get-role --role-name "$web_role" --query Role.Arn --output text)
echo "web role $web_role_arn"

route_status=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$endpoint" || true)
subscribed=$(aws sns list-subscriptions-by-topic --topic-arn "$topic_arn" --query "Subscriptions[?Endpoint=='${endpoint}'].SubscriptionArn" --output text)
if [ -z "$subscribed" ] && { [ "$route_status" = "404" ] || [ "$route_status" = "000" ]; }; then
  echo "the panel does not serve $endpoint yet; rerun after deploying it"
elif [ -z "$subscribed" ]; then
  aws sns subscribe --topic-arn "$topic_arn" --protocol https --notification-endpoint "$endpoint" --attributes RawMessageDelivery=false >/dev/null
  echo "subscription requested for $endpoint; the panel confirms it"
else
  echo "subscription $subscribed"
fi

cat <<EOF
panel settings:
  UNDERSTUDY_INBOUND_EMAIL_DOMAIN=${INBOUND_EMAIL_DOMAIN}
  UNDERSTUDY_INBOUND_SNS_TOPIC_ARN=${topic_arn}
  UNDERSTUDY_INBOUND_S3_BUCKET=${bucket}
  service account role: ${web_role_arn}
EOF
