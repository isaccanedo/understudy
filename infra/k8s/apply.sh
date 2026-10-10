#!/usr/bin/env bash
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
source "$here/../lib.sh"
require K8S_NAMESPACE PUBLIC_HOST CERTIFICATE_ARN ALB_GROUP NODE_ARCH
vars='${AWS_REGION} ${DEPLOY_K8S_GROUP} ${NAME_PREFIX} ${K8S_NAMESPACE} ${IMAGE} ${NODE_ARCH} ${PUBLIC_HOST} ${CERTIFICATE_ARN} ${ALB_GROUP}'

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

render() {
  envsubst "$vars" < "$here/$1"
}

render namespace.yaml | kubectl apply -f -
if [ -n "${DEPLOY_K8S_GROUP:-}" ] && kubectl auth can-i create rolebindings -n "$K8S_NAMESPACE" >/dev/null 2>&1; then
  render rbac.yaml | kubectl apply -f -
fi
curl -fsSL "${DB_CA_BUNDLE_URL:-https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem}" -o "$tmp/db-ca.pem"
kubectl -n "$K8S_NAMESPACE" create configmap "${NAME_PREFIX}-db-ca" --from-file=db-ca.pem="$tmp/db-ca.pem" --dry-run=client -o yaml | kubectl apply -f -
kubectl -n "$K8S_NAMESPACE" create serviceaccount "${NAME_PREFIX}-web" --dry-run=client -o yaml | kubectl apply -f - >/dev/null
if [ -n "${WEB_ROLE_ARN:-}" ]; then
  kubectl -n "$K8S_NAMESPACE" annotate serviceaccount "${NAME_PREFIX}-web" "eks.amazonaws.com/role-arn=${WEB_ROLE_ARN}" --overwrite >/dev/null
fi
render service.yaml | kubectl apply -f -
render ingress.yaml | kubectl apply -f -
if [ -n "${INGRESS_SOURCE_CIDRS:-}" ] && [ -n "${DB_CIDRS:-}" ]; then
  bash "$here/networkpolicy.sh"
fi

if [ -n "${IMAGE:-}" ]; then
  render web.yaml | kubectl apply -f -
  kubectl -n "$K8S_NAMESPACE" rollout status "deployment/${NAME_PREFIX}-web" --timeout=300s
  kubectl -n "$K8S_NAMESPACE" delete deployment "${NAME_PREFIX}-placeholder" --ignore-not-found
elif ! kubectl -n "$K8S_NAMESPACE" get deployment "${NAME_PREFIX}-web" >/dev/null 2>&1; then
  render placeholder.yaml | kubectl apply -f -
fi
