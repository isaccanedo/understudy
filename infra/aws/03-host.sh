#!/usr/bin/env bash
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
source "$here/../lib.sh"
require AWS_ACCOUNT_ID HOST_INSTANCE_TYPE HOST_VOLUME_GB

ecr_policy=$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {"Effect": "Allow", "Action": "ecr:GetAuthorizationToken", "Resource": "*"},
    {"Effect": "Allow", "Action": ["ecr:BatchCheckLayerAvailability", "ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:DescribeImages"], "Resource": "arn:aws:ecr:${AWS_REGION}:${AWS_ACCOUNT_ID}:repository/${NAME_PREFIX}-*"}
  ]
}
JSON
)
params_policy=$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {"Effect": "Allow", "Action": "ssm:GetParameter", "Resource": "arn:aws:ssm:${AWS_REGION}:${AWS_ACCOUNT_ID}:parameter/${NAME_PREFIX}/host/*"}
  ]
}
JSON
)

if ! aws iam get-role --role-name "$HOST_ROLE" >/dev/null 2>&1; then
  aws iam create-role --role-name "$HOST_ROLE" --tags "$TAGS_SPEC" --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null
  aws iam attach-role-policy --role-name "$HOST_ROLE" --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
fi
aws iam put-role-policy --role-name "$HOST_ROLE" --policy-name "${NAME_PREFIX}-ecr-pull" --policy-document "$ecr_policy"
aws iam put-role-policy --role-name "$HOST_ROLE" --policy-name "${NAME_PREFIX}-host-params" --policy-document "$params_policy"
if ! aws iam get-instance-profile --instance-profile-name "$HOST_ROLE" >/dev/null 2>&1; then
  aws iam create-instance-profile --instance-profile-name "$HOST_ROLE" --tags "$TAGS_SPEC" >/dev/null
  aws iam add-role-to-instance-profile --instance-profile-name "$HOST_ROLE" --role-name "$HOST_ROLE"
  sleep 15
fi

existing=$(aws ec2 describe-instances --filters "Name=tag:Name,Values=$HOST_NAME" "Name=tag:Project,Values=$PROJECT_TAG" "Name=instance-state-name,Values=pending,running,stopping,stopped" --query 'Reservations[0].Instances[0].InstanceId' --output text)
if [ "$existing" != "None" ] && [ -n "$existing" ]; then
  echo "instance $existing"
  exit 0
fi

subnet_id=$(find_tagged subnets "${NAME_PREFIX}-public-a" 'Subnets[0].SubnetId')
sg_id=$(find_tagged security-groups "${NAME_PREFIX}-host-sg" 'SecurityGroups[0].GroupId')
ami_id=$(aws ssm get-parameter --name /aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id --query Parameter.Value --output text)

aws ec2 run-instances \
  --image-id "$ami_id" \
  --instance-type "$HOST_INSTANCE_TYPE" \
  --subnet-id "$subnet_id" \
  --security-group-ids "$sg_id" \
  --associate-public-ip-address \
  --iam-instance-profile "Name=$HOST_ROLE" \
  --metadata-options HttpTokens=required,HttpEndpoint=enabled,HttpPutResponseHopLimit=1 \
  --block-device-mappings "[{\"DeviceName\":\"/dev/sda1\",\"Ebs\":{\"VolumeSize\":${HOST_VOLUME_GB},\"VolumeType\":\"gp3\",\"Encrypted\":true,\"DeleteOnTermination\":true}}]" \
  --user-data "file://$here/host-user-data.sh" \
  --tag-specifications "$(tag_spec instance "$HOST_NAME")" "$(tag_spec volume "$HOST_NAME")" "$(tag_spec network-interface "$HOST_NAME")" \
  --query 'Instances[0].InstanceId' --output text
