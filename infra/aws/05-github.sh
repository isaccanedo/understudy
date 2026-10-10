#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/../lib.sh"
require AWS_ACCOUNT_ID GITHUB_REPO EKS_CLUSTER EKS_DEPLOY_ROLE_ARN PUBLIC_HOST CERTIFICATE_ARN ALB_GROUP NODE_ARCH

owner="${GITHUB_REPO%%/*}"
repo="${GITHUB_REPO##*/}"
owner_id=$(gh api "orgs/$owner" --jq .id 2>/dev/null || gh api "users/$owner" --jq .id)
repo_id=$(gh api "repos/$GITHUB_REPO" --jq .id)
subjects=""
for branch in ${DEPLOY_BRANCHES:-main}; do
  for prefix in "repo:${GITHUB_REPO}" "repo:${owner}@${owner_id}/${repo}@${repo_id}"; do
    subjects="${subjects:+$subjects, }\"${prefix}:ref:refs/heads/${branch}\""
  done
done
oidc="arn:aws:iam::${AWS_ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com"

trust=$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {"Federated": "$oidc"},
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {"token.actions.githubusercontent.com:aud": "sts.amazonaws.com"},
        "StringLike": {
          "token.actions.githubusercontent.com:sub": [${subjects}]
        }
      }
    }
  ]
}
JSON
)
policy=$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {"Effect": "Allow", "Action": "ecr:GetAuthorizationToken", "Resource": "*"},
    {
      "Effect": "Allow",
      "Action": ["ecr:BatchCheckLayerAvailability", "ecr:BatchGetImage", "ecr:DescribeImages", "ecr:GetDownloadUrlForLayer", "ecr:InitiateLayerUpload", "ecr:UploadLayerPart", "ecr:CompleteLayerUpload", "ecr:PutImage"],
      "Resource": "arn:aws:ecr:${AWS_REGION}:${AWS_ACCOUNT_ID}:repository/${NAME_PREFIX}-*"
    },
    {"Effect": "Allow", "Action": ["sts:AssumeRole", "sts:TagSession"], "Resource": "${EKS_DEPLOY_ROLE_ARN}"},
    {"Effect": "Allow", "Action": "eks:DescribeCluster", "Resource": "arn:aws:eks:${AWS_REGION}:${AWS_ACCOUNT_ID}:cluster/${EKS_CLUSTER}"},
    {"Effect": "Allow", "Action": "ssm:SendCommand", "Resource": "arn:aws:ssm:${AWS_REGION}::document/AWS-RunShellScript"},
    {"Effect": "Allow", "Action": "ssm:SendCommand", "Resource": "arn:aws:ec2:${AWS_REGION}:${AWS_ACCOUNT_ID}:instance/*", "Condition": {"StringEquals": {"aws:ResourceTag/Project": "${PROJECT_TAG}"}}},
    {"Effect": "Allow", "Action": ["ssm:GetCommandInvocation", "ec2:DescribeInstances"], "Resource": "*"}
  ]
}
JSON
)

if ! aws iam get-role --role-name "$DEPLOY_ROLE" >/dev/null 2>&1; then
  aws iam create-role --role-name "$DEPLOY_ROLE" --tags "$TAGS_SPEC" --assume-role-policy-document "$trust" >/dev/null
else
  aws iam update-assume-role-policy --role-name "$DEPLOY_ROLE" --policy-document "$trust"
fi
aws iam put-role-policy --role-name "$DEPLOY_ROLE" --policy-name "${NAME_PREFIX}-deploy" --policy-document "$policy"
role_arn=$(aws iam get-role --role-name "$DEPLOY_ROLE" --query Role.Arn --output text)

for name in NAME_PREFIX AWS_REGION EKS_CLUSTER K8S_NAMESPACE PUBLIC_HOST ALB_GROUP NODE_ARCH; do
  gh variable set "$name" -R "$GITHUB_REPO" --body "${!name}"
done
gh variable set ECR_REGISTRY -R "$GITHUB_REPO" --body "$(ecr_registry)"
gh variable set SOURCE_REPO -R "$GITHUB_REPO" --body "${SOURCE_REPO:-arvoreeducacao/understudy}"
gh variable set IMAGE_SOURCE -R "$GITHUB_REPO" --body "${IMAGE_SOURCE:-ghcr.io/arvoreeducacao}"
gh secret set CERTIFICATE_ARN -R "$GITHUB_REPO" --body "$CERTIFICATE_ARN"
gh secret set AWS_DEPLOY_ROLE -R "$GITHUB_REPO" --body "$role_arn"
gh secret set AWS_EKS_ROLE -R "$GITHUB_REPO" --body "$EKS_DEPLOY_ROLE_ARN"
echo "role $role_arn"
