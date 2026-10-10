#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/../lib.sh"
require VPC_CIDR SUBNET_CIDR SUBNET_AZ

vpc_id=$(find_tagged vpcs "${NAME_PREFIX}-vpc" 'Vpcs[0].VpcId')
if [ -z "$vpc_id" ]; then
  vpc_id=$(aws ec2 create-vpc --cidr-block "$VPC_CIDR" --tag-specifications "$(tag_spec vpc "${NAME_PREFIX}-vpc")" --query Vpc.VpcId --output text)
  aws ec2 wait vpc-available --vpc-ids "$vpc_id"
  aws ec2 modify-vpc-attribute --vpc-id "$vpc_id" --enable-dns-support
  aws ec2 modify-vpc-attribute --vpc-id "$vpc_id" --enable-dns-hostnames
fi
echo "vpc $vpc_id"

igw_id=$(find_tagged internet-gateways "${NAME_PREFIX}-igw" 'InternetGateways[0].InternetGatewayId')
if [ -z "$igw_id" ]; then
  igw_id=$(aws ec2 create-internet-gateway --tag-specifications "$(tag_spec internet-gateway "${NAME_PREFIX}-igw")" --query InternetGateway.InternetGatewayId --output text)
  aws ec2 attach-internet-gateway --internet-gateway-id "$igw_id" --vpc-id "$vpc_id"
fi
echo "internet-gateway $igw_id"

subnet_id=$(find_tagged subnets "${NAME_PREFIX}-public-a" 'Subnets[0].SubnetId')
if [ -z "$subnet_id" ]; then
  subnet_id=$(aws ec2 create-subnet --vpc-id "$vpc_id" --cidr-block "$SUBNET_CIDR" --availability-zone "$SUBNET_AZ" --tag-specifications "$(tag_spec subnet "${NAME_PREFIX}-public-a")" --query Subnet.SubnetId --output text)
  aws ec2 modify-subnet-attribute --subnet-id "$subnet_id" --map-public-ip-on-launch
fi
echo "subnet $subnet_id"

rt_id=$(find_tagged route-tables "${NAME_PREFIX}-public-rt" 'RouteTables[0].RouteTableId')
if [ -z "$rt_id" ]; then
  rt_id=$(aws ec2 create-route-table --vpc-id "$vpc_id" --tag-specifications "$(tag_spec route-table "${NAME_PREFIX}-public-rt")" --query RouteTable.RouteTableId --output text)
  aws ec2 create-route --route-table-id "$rt_id" --destination-cidr-block 0.0.0.0/0 --gateway-id "$igw_id" >/dev/null
  aws ec2 associate-route-table --route-table-id "$rt_id" --subnet-id "$subnet_id" >/dev/null
fi
echo "route-table $rt_id"

sg_id=$(find_tagged security-groups "${NAME_PREFIX}-host-sg" 'SecurityGroups[0].GroupId')
if [ -z "$sg_id" ]; then
  sg_id=$(aws ec2 create-security-group --vpc-id "$vpc_id" --group-name "${NAME_PREFIX}-host-sg" --description "Agent host: no inbound, egress to internet only" --tag-specifications "$(tag_spec security-group "${NAME_PREFIX}-host-sg")" --query GroupId --output text)
fi
echo "security-group $sg_id"
