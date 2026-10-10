# Infrastructure

Scripts and manifests that stand up Understudy on AWS: an isolated network with one VM that runs the agent computers, a Postgres database, the container registries, and the web panel on an existing EKS cluster.

```
                 internet
                    │
        ┌───────────┴────────────┐
        │                        │
   ALB (HTTPS, 3600 s idle)   isolated VPC, no inbound
        │                        │
   EKS: <prefix>-web  ◄──WSS──  VM: <prefix>-host container
        │                        └─ one computer container per agent
   RDS Postgres (EKS nodes only)
```

Nothing connects into the isolated VPC. The host and the computers dial out to the panel. The VM has no inbound rule at all; operators reach it through SSM Session Manager. Instance metadata is limited to one hop, so containers on the VM cannot read the instance credentials.

## Configure

Copy `config.example.env` to `config.env` (gitignored) and fill it in. Every script reads it; any value can also come from the environment. `UNDERSTUDY_INFRA_CONFIG` points to another file.

| Variable | Meaning |
|---|---|
| `NAME_PREFIX` | Prefix of every resource name and value of the `Project` tag |
| `AWS_REGION`, `AWS_ACCOUNT_ID` | Where everything lives |
| `GITHUB_REPO`, `DEPLOY_BRANCHES` | Your private deploy repository and the branches allowed to deploy through GitHub OIDC |
| `SOURCE_REPO`, `IMAGE_SOURCE` | Where the code and the published images come from; default `arvoreeducacao/understudy` and `ghcr.io/arvoreeducacao` |
| `PUBLIC_HOST` | Panel hostname; the panel URL is `https://$PUBLIC_HOST` |
| `CERTIFICATE_ARN` | ACM certificate that covers `PUBLIC_HOST` |
| `ALB_GROUP` | Ingress group of the ALB; use a dedicated one, the idle timeout is ALB-wide |
| `NODE_ARCH` | CPU architecture of the EKS nodes (`arm64` or `amd64`) |
| `ALLOWED_EMAIL_DOMAIN`, `ADMIN_EMAILS` | Who can sign in, and who is admin |
| `HOST_ID` | Fixed id the VM's host reports; keep it when the VM is replaced so its agents follow; default `<prefix>-host-1` |
| `HOST_IDS` | Comma-separated host ids the panel accepts; default `HOST_ID` |
| `BLOCKED_CIDRS` | Extra ranges the panel never connects to for tools, on top of the private ones (use the cluster pod and service ranges) |
| `TIMEZONE` | IANA time zone the panel uses for schedules |
| `VPC_CIDR`, `SUBNET_CIDR`, `SUBNET_AZ` | Isolated network for the VM |
| `HOST_INSTANCE_TYPE`, `HOST_VOLUME_GB` | VM size |
| `EKS_CLUSTER`, `EKS_VPC_ID`, `EKS_NODE_SG` | Cluster that runs the panel and the security group its nodes use |
| `DB_SUBNET_IDS`, `DB_INSTANCE_CLASS` | Private subnets of the EKS VPC for the database |
| `EKS_DEPLOY_ROLE_ARN` | Role mapped to Kubernetes write access that CI chains into |
| `INGRESS_SOURCE_CIDRS`, `DB_CIDRS`, `EXTRA_BLOCKED_CIDRS` | NetworkPolicy for the panel: who may connect (the load balancer subnets), where the database lives, and extra ranges to block on top of the private ones. Needs a CNI that enforces NetworkPolicy |
| `INBOUND_EMAIL_DOMAIN`, `INBOUND_EMAIL_RETENTION_DAYS`, `CLOUDFLARE_ZONE_NAME`, `WEB_ROLE_ARN` | Inbound email: receiving domain, days mail is kept, the Cloudflare zone for its records, and the role annotated on the panel's service account |
| `DEPLOY_K8S_GROUP` | Kubernetes group of that role; `k8s/apply.sh`, run by an admin, grants it deploy rights in the namespace |

The cluster must already run the AWS Load Balancer Controller and external-dns, and the account must have the GitHub OIDC provider.

## Run, in order

```
bash aws/01-network.sh
bash aws/02-ecr.sh
bash aws/03-host.sh
bash aws/04-rds.sh
bash aws/05-github.sh
bash aws/06-inbound-email.sh
bash k8s/apply.sh
bash k8s/secret.sh
bash host/deploy.sh
```

Every script is idempotent: it finds what already exists by name and tag and creates only what is missing.

| Script | Creates |
|---|---|
| `aws/01-network.sh` | VPC, internet gateway, one public subnet, route table, security group without inbound rules |
| `aws/02-ecr.sh` | `<prefix>-web`, `<prefix>-computer`, `<prefix>-host` registries |
| `aws/03-host.sh` | Instance role (SSM, pull from the three registries, read `/<prefix>/host/*`), Ubuntu 24.04 VM with Docker (`host-user-data.sh`) |
| `aws/04-rds.sh` | Postgres 16, encrypted, private, password kept by RDS in Secrets Manager, reachable only from `EKS_NODE_SG` |
| `aws/06-inbound-email.sh` | SES receiving for `INBOUND_EMAIL_DOMAIN`: encrypted S3 bucket with `INBOUND_EMAIL_RETENTION_DAYS` expiry, SNS topic subscribed to the panel, receipt rule set, MX and DKIM records (created in Cloudflare when `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ZONE_NAME` are set, printed otherwise), and the `<prefix>-web` role the panel's service account assumes to read mail. Run it again after the panel is deployed so the SNS subscription is confirmed |
| `aws/05-github.sh` | `github-actions-<prefix>-deploy` role and the variables and secrets the deploy workflow reads, set on your private deploy repository |
| `k8s/apply.sh` | Namespace, deploy role, ConfigMap with the RDS CA bundle (the panel verifies the database certificate), Service, Ingress, and a placeholder that answers `/api/health` until the first web image; with `IMAGE` set it deploys the web image and removes the placeholder |
| `k8s/secret.sh` | Secret `<prefix>-env` (database URL, random auth secret and host token, public URL, email rules); copies the host token to SSM `/<prefix>/host/token` |
| `host/deploy.sh [tag]` | Through SSM: pulls the computer and host images on the VM and (re)starts the host container with the Docker socket |

Random values are kept across runs: `k8s/secret.sh` reuses what the Secret already holds. Set `SLACK_BOT_TOKEN` or `ADMIN_EMAILS` in the environment and rerun it to change them.

## Continuous deployment

This repository only publishes images. `.github/workflows/publish.yml` runs the tests, builds `apps/web` (amd64 and arm64), `apps/computer` and `apps/host` (amd64) on every push to `main` and publishes them as `ghcr.io/arvoreeducacao/understudy-<app>`, tagged with the commit, `main` and `latest`. Nothing here holds cloud credentials.

Deploying is done from a private repository of your own, so your account, cluster and secrets never appear in public logs. Copy `infra/github/deploy.yml` to `.github/workflows/deploy.yml` in that repository and run `aws/05-github.sh` with `GITHUB_REPO` pointing at it. Every ten minutes, or on demand, the workflow finds the latest published commit, copies the three images to your ECR, restarts the host with `host/deploy.sh`, rolls the panel out with `k8s/apply.sh` and marks the web image `deployed`, so a commit is deployed once. A manual run can deploy a given commit, or force the current one again.

## Reach the VM

```
aws ssm start-session --target <instance-id>
```
