# solution-basic — Architecture Spec

## Overview

`solution-basic` is a Node.js polling processor that continuously reads pending shipping tasks from a shared MySQL database (RDS), logs each task's metadata to AWS CloudWatch Logs, and marks each task as processed. It runs as a Docker container on a dedicated EC2 instance. The `producer` Next.js web app creates the tasks and displays real-time processing status; `solution-basic` is the consumer in this polling-based model.

---

## Infrastructure Decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| EC2 instance type (processor) | `t3.micro` | Better baseline performance than t2 at similar cost |
| EC2 instance type (producer) | `t3.micro` | Better baseline performance than t2 at similar cost |
| EC2 OS | Ubuntu LTS 24.04 | AMI resolved via SSM at deploy time |
| EC2 EBS volume | 8 GB gp2 | Free Tier: 30 GB total across instances |
| RDS instance type | `db.t2.micro`, Single-AZ | Free Tier: 750 hrs/month |
| RDS storage | 20 GB gp2 | Free Tier limit |
| Container registry | ECR (one repo per component) | Free Tier: 500 MB/month — use multi-stage builds |
| VPC topology | Public subnets only | No NAT Gateway (not Free Tier) |
| Polling interval | 5 seconds | |
| Producer CFN stack | Shared between solution-basic and solution-kafka | |

---

## Components

| Component | Dockerfile | ECR Repo | CFN Stack |
|-----------|-----------|----------|-----------|
| Producer (Next.js) | `producer/Dockerfile` | `aws2026/producer` | `infra/producer.yml` |
| Processor (Polling) | `solution-basic/Dockerfile` | `aws2026/solution-basic` | `infra/solution-basic.yml` |

---

## CloudFormation Template Layout

```
infra/
├── shared.yml            # VPC, RDS, schema bootstrap (Lambda Custom Resource)
├── producer.yml          # EC2 t3.micro for Next.js — shared by all demo solutions
├── solution-basic.yml    # EC2 t3.micro for polling processor, CW log group, IAM
└── solution-kafka.yml    # (future) Lambda functions, MSK
```

---

## Shared Infrastructure (`infra/shared.yml`)

Resources:

- **VPC** — public subnets only (two AZs for RDS subnet group requirement); Internet Gateway; public route table
- **Security groups**
  - `RdsSg`: inbound 3306 from EC2 security groups only
  - `ProducerEc2Sg`: inbound 80 from internet, outbound to `RdsSg`
  - `ProcessorEc2Sg`: no inbound, outbound to `RdsSg` and CloudWatch
- **RDS MySQL** — `db.t4g.micro`, Single-AZ, 20 GB gp2, publicly accessible (protected by `RdsSg`)
- **SSM Parameters** — `::DB_USER_PARAM::` (`/app/db/user`) and `::DB_PASSWORD_PARAM::` (`/app/db/password`), Standard tier (free), stored as String

**Stack Outputs** (cross-stack imports):

| Output | Export name | Used by |
|--------|-------------|---------|
| `VpcId` | `app-VpcId` | producer.yml, solution-basic.yml |
| `PublicSubnetId` | `app-PublicSubnetId` | producer.yml, solution-basic.yml |
| `PublicSubnet2Id` | `app-PublicSubnet2Id` | RDS subnet group (requires two AZs) |
| `RdsSgId` | `app-RdsSgId` | producer.yml, solution-basic.yml |
| `ProducerEc2SgId` | `app-ProducerEc2SgId` | producer.yml |
| `ProcessorEc2SgId` | `app-ProcessorEc2SgId` | solution-basic.yml |
| `RDSEndpoint` | `app-RDSEndpoint` | producer.yml, solution-basic.yml |
| `RDSPort` | `app-RDSPort` | producer.yml, solution-basic.yml |
| `DBUserParamName` | `app-DBUserParamName` | producer.yml, solution-basic.yml |
| `DBPasswordParamName` | `app-DBPasswordParamName` | producer.yml, solution-basic.yml |

---

## Producer Stack (`infra/producer.yml`)

Resources:

- EC2 `t3.micro`, Ubuntu LTS 24.04
  - AMI: `{{resolve:ssm:/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id}}`
  - UserData: install Docker + AWS CLI v2 + mysql client → fetch DB credentials from SSM → wait for RDS → apply `producer/db/schema.sql` inline (idempotent) → write `/etc/producer.env` → ECR login → `docker pull aws2026/producer` → install + start `producer.service` (systemd)
  - EBS root: 8 GB gp2
- IAM Instance Profile
  - Managed: `AmazonSSMManagedInstanceCore` (SSM Session Manager access)
  - `ecr:GetAuthorizationToken`, `ecr:BatchGetImage`, `ecr:GetDownloadUrlForLayer`
  - `ssm:GetParameter` on `/app/db/user` and `/app/db/password`
- Elastic IP — stable public address
- **EventBridgeSSMRole** + **ProducerRedeployRule** — EventBridge rule that listens for `ECR Image Action / PUSH` on `aws2026/producer:latest` and triggers an SSM `AWS-RunShellScript` command on the `app-producer` EC2 to pull the new image and restart the systemd service (zero-touch redeploy on push)

**Outputs**: `ProducerPublicIP`, `ProducerURL`

---

## solution-basic Stack (`infra/solution-basic.yml`)

Resources:

- EC2 `t3.micro`, Ubuntu LTS 24.04 (same AMI SSM path as producer)
  - UserData: install Docker + AWS CLI v2 → fetch DB password from SSM → ECR login → `docker pull aws2026/solution-basic` → `docker run --restart unless-stopped` with env vars
  - EBS root: 8 GB gp2
- IAM Instance Profile
  - Managed: `AmazonSSMManagedInstanceCore`
  - `ecr:GetAuthorizationToken`, `ecr:BatchGetImage`, `ecr:GetDownloadUrlForLayer`
  - `ssm:GetParameter` on `/app/db/user` and `/app/db/password`
  - `logs:CreateLogStream`, `logs:PutLogEvents` scoped to the `ProcessorLogGroup` ARN
- **CloudWatch Log Group** `/solution-basic/tasks` — 7-day retention (Free Tier: 5 GB ingestion/month)
- Imports `RDSEndpoint`, `RDSPort`, `PublicSubnetId`, `ProcessorEc2SgId` from `infra/shared.yml`

**Outputs**: `ProcessorInstanceId`

---

## Environment Variables (Processor Container)

| Variable | Source | Default |
|----------|--------|---------|
| `::DB_HOST::` | CFN cross-stack → EC2 UserData | RDS endpoint |
| `::DB_PORT::` | CFN cross-stack | `3306` |
| `::DB_USER::` | SSM Parameter | — |
| `::DB_PASSWORD::` | SSM Parameter fetched in UserData at boot (`/app/db/password`) | — |
| `::DB_NAME::` | EC2 UserData | `producer` |
| `::POLL_INTERVAL_MS::` | EC2 UserData | `5000` |
| `::AWS_REGION::` | EC2 instance metadata (auto) | — |
| `::CW_LOG_GROUP::` | EC2 UserData | `/solution-basic/tasks` |

---

## Deployment Flow

### Local development

MySQL runs in Docker Compose. Both apps are built and run as plain Docker containers against it — no AWS services needed locally.

```bash
# 1. Start MySQL
docker compose up -d

# 2. Build images
docker build -t aws2026/producer:latest producer/
docker build -t aws2026/solution-basic:latest solution-basic/

# 3. Run producer (http://localhost:3000)
docker run --rm -p 3000:3000 \
  -e DB_HOST=host.docker.internal \
  -e DB_PORT=3306 \
  -e DB_USER=admin \
  -e DB_PASSWORD=changeme123 \
  -e DB_NAME=producer \
  aws2026/producer:latest

# 4. Run processor (separate terminal)
docker run --rm \
  -e DB_HOST=host.docker.internal \
  -e DB_PORT=3306 \
  -e DB_USER=admin \
  -e DB_PASSWORD=changeme123 \
  -e DB_NAME=producer \
  -e POLL_INTERVAL_MS=5000 \
  -e CW_LOG_GROUP=/solution-basic/tasks \
  -e AWS_REGION=us-east-1 \
  aws2026/solution-basic:latest
```

---

### Production (real AWS)

```bash
export REGION=$(aws configure get region)
export ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
export ECR_BASE=$ACCOUNT.dkr.ecr.$REGION.amazonaws.com

# 1. Deploy shared infrastructure (VPC, RDS, ECR repos, SSM parameters)
aws cloudformation deploy \
  --template-file infra/shared.yml \
  --stack-name app-shared \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides DBPassword=<your-password>

# 2. Build and push images to ECR
aws ecr get-login-password --region $REGION | \
  docker login --username AWS --password-stdin $ECR_BASE
docker buildx build --platform linux/amd64 --load -t $ECR_BASE/aws2026/producer:latest producer/
docker buildx build --platform linux/amd64 --load -t $ECR_BASE/aws2026/solution-basic:latest solution-basic/
docker push $ECR_BASE/aws2026/producer:latest
docker push $ECR_BASE/aws2026/solution-basic:latest

# 3. Deploy producer EC2
aws cloudformation deploy \
  --template-file infra/producer.yml \
  --stack-name app-producer \
  --capabilities CAPABILITY_IAM

# 4. Deploy processor EC2
aws cloudformation deploy \
  --template-file infra/solution-basic.yml \
  --stack-name app-solution-basic \
  --capabilities CAPABILITY_IAM
```

---

## Component Boundaries

| Concern | Owner |
|---------|-------|
| `tasks` table schema | Producer (`producer/db/schema.sql`) |
| Schema application | `infra/producer.yml` (EC2 UserData, runs on first boot) |
| RDS instance + VPC | `infra/shared.yml` |
| CloudWatch log group | `infra/solution-basic.yml` |
| EC2 for processor | `infra/solution-basic.yml` |
| EC2 for producer | `infra/producer.yml` |
| ECR repositories | `infra/shared.yml` (`DeletionPolicy: Retain` — survive stack deletes) |

---

## Open Questions

- [ ] Should ECR repo creation be part of a CFN template or remain a one-time CLI step?
- [ ] Add an ALB in front of the producer EC2 for HTTPS termination, or keep port 3000 direct for the demo?
