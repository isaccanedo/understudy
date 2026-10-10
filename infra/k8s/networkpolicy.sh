#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/../lib.sh"
require K8S_NAMESPACE INGRESS_SOURCE_CIDRS DB_CIDRS

private_ranges="10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 100.64.0.0/10 169.254.0.0/16 127.0.0.0/8 ${EXTRA_BLOCKED_CIDRS:-}"

{
  cat <<YAML
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: ${NAME_PREFIX}-web
  namespace: ${K8S_NAMESPACE}
  labels:
    project: ${NAME_PREFIX}
spec:
  podSelector:
    matchLabels:
      app: ${NAME_PREFIX}-web
  policyTypes: [Ingress, Egress]
  ingress:
    - ports:
        - protocol: TCP
          port: 3000
      from:
YAML
  for cidr in $INGRESS_SOURCE_CIDRS; do
    printf '        - ipBlock:\n            cidr: %s\n' "$cidr"
  done
  cat <<YAML
  egress:
    - ports:
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 53
      to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: kube-system
          podSelector:
            matchLabels:
              k8s-app: kube-dns
    - ports:
        - protocol: TCP
          port: 5432
      to:
YAML
  for cidr in $DB_CIDRS; do
    printf '        - ipBlock:\n            cidr: %s\n' "$cidr"
  done
  cat <<YAML
    - to:
        - ipBlock:
            cidr: 0.0.0.0/0
            except:
YAML
  for cidr in $private_ranges; do
    printf '              - %s\n' "$cidr"
  done
} | kubectl apply -f -
