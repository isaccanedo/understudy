#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/../lib.sh"
require EKS_VPC_ID EKS_NODE_SG DB_SUBNET_IDS DB_INSTANCE_CLASS

sg_id=$(aws ec2 describe-security-groups --filters "Name=vpc-id,Values=$EKS_VPC_ID" "Name=group-name,Values=${DB_SECURITY_GROUP}" --query 'SecurityGroups[0].GroupId' --output text)
if [ "$sg_id" = "None" ] || [ -z "$sg_id" ]; then
  sg_id=$(aws ec2 create-security-group --vpc-id "$EKS_VPC_ID" --group-name "$DB_SECURITY_GROUP" --description "Postgres: 5432 from the EKS nodes only" --tag-specifications "$(tag_spec security-group "$DB_SECURITY_GROUP")" --query GroupId --output text)
  aws ec2 authorize-security-group-ingress --group-id "$sg_id" --ip-permissions "IpProtocol=tcp,FromPort=5432,ToPort=5432,UserIdGroupPairs=[{GroupId=$EKS_NODE_SG,Description=eks-nodes}]" >/dev/null
fi
echo "security-group $sg_id"

if ! aws rds describe-db-subnet-groups --db-subnet-group-name "$DB_SUBNET_GROUP" >/dev/null 2>&1; then
  aws rds create-db-subnet-group --db-subnet-group-name "$DB_SUBNET_GROUP" --db-subnet-group-description "${NAME_PREFIX} Postgres" --subnet-ids $DB_SUBNET_IDS --tags "$TAGS_SPEC" >/dev/null
fi

if aws rds describe-db-instances --db-instance-identifier "$DB_IDENTIFIER" >/dev/null 2>&1; then
  echo "rds $DB_IDENTIFIER exists"
  exit 0
fi

aws rds create-db-instance \
  --db-instance-identifier "$DB_IDENTIFIER" \
  --db-instance-class "$DB_INSTANCE_CLASS" \
  --engine postgres \
  --engine-version 16 \
  --allocated-storage 20 \
  --storage-type "${DB_STORAGE_TYPE:-gp3}" \
  --storage-encrypted \
  --no-publicly-accessible \
  --db-name "$DB_NAME" \
  --master-username "$DB_USER" \
  --manage-master-user-password \
  --db-subnet-group-name "$DB_SUBNET_GROUP" \
  --vpc-security-group-ids "$sg_id" \
  --backup-retention-period 7 \
  --copy-tags-to-snapshot \
  --deletion-protection \
  --tags "$TAGS_SPEC" \
  --query 'DBInstance.DBInstanceIdentifier' --output text
