# aws-conf demo

A side-by-side comparison of two approaches to the same business problem — processing shipping tasks — to illustrate the cost and operational trade-offs between a polling model and an event-driven model.

## What this demonstrates

| | solution-basic | solution-kafka |
|---|---|---|
| **Trigger** | Continuous DB poll (5 s interval) | Kafka event per task |
| **Compute** | EC2 always running | Lambda, invoked on demand |
| **Idle cost** | Constant | Zero |
| **Scaling** | Manual / vertical | Automatic per partition |
| **Status** | Complete | In progress |

## Repository layout

```
.
├── infra/
│   ├── shared.yml          # VPC, RDS (MySQL), ECR repos, SSM params
│   ├── producer.yml        # EC2 for the Next.js web app
│   ├── solution-basic.yml  # EC2 for the polling processor, CW log group
│   └── solution-kafka.yml  # (planned) Lambda functions, MSK / Kafka EC2
│
├── producer/               # Next.js web app — creates tasks, shows status
├── solution-basic/         # Node.js polling processor
├── solution-kafka/         # Lambda-based event-driven processor (in progress)
│
├── docker-compose.yml      # LocalStack + MySQL for local development
├── deploy.sh               # One-command deploy to dev (LocalStack) or prod (AWS)
└── env.sh                  # Shell environment helpers
```

## Components

### producer

Next.js + React web app. Lets merchants create shipping tasks (written to MySQL) and watch them get processed in real time. Shared by both solutions.

- Stack: Next.js, Tailwind CSS, MUI, MySQL
- Dockerfile: `producer/Dockerfile`
- ECR repo: `aws2026/producer`
- CFN stack: `infra/producer.yml`

### solution-basic

A Node.js process that polls MySQL every 5 seconds for pending tasks, executes each one (logs to CloudWatch), and marks it processed. Runs as a Docker container on EC2.

- Stack: Node.js, TypeScript
- Dockerfile: `solution-basic/Dockerfile`
- ECR repo: `aws2026/solution-basic`
- CFN stack: `infra/solution-basic.yml`
- Full spec: [solution-basic/SPEC.md](solution-basic/SPEC.md)

### solution-kafka _(in progress)_

Event-driven replacement. The producer publishes to per-company Kafka topics; Lambda functions are triggered per topic and run only when there is work, eliminating idle compute.

- Stack: Node.js Lambdas, Kafka (EC2 or MSK)
- CFN stack: `infra/solution-kafka.yml` (not yet created)

## Local development

Requires Docker and [pnpm](https://pnpm.io).

```bash
# 1. Start MySQL and LocalStack
docker compose up -d

# 2. Source environment helpers (sets LOCALSTACK_AUTH_TOKEN, etc.)
source env.sh

# 3. Deploy shared infra to LocalStack (VPC, RDS, ECR, SSM)
./deploy.sh dev

# 4. Run the producer web app (http://localhost:3000)
cd producer && pnpm dev

# 5. Run the polling processor (separate terminal)
cd solution-basic && pnpm start
```

## Production deployment (AWS)

`deploy.sh` handles all four steps: shared infra → build images → push to ECR → app stacks.

```bash
./deploy.sh prod --db-password <your-password>
```

What it does:

1. Deploys `infra/shared.yml` (VPC, RDS, ECR repos, SSM parameters)
2. Builds Docker images for `producer` and `solution-basic` (`linux/amd64`)
3. Pushes images to ECR
4. Deploys `infra/producer.yml` and `infra/solution-basic.yml`

Producer URL is printed at the end.

### Manual step-by-step (if needed)

```bash
export REGION=$(aws configure get region)
export ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
export ECR_BASE=$ACCOUNT.dkr.ecr.$REGION.amazonaws.com

aws cloudformation deploy \
  --template-file infra/shared.yml \
  --stack-name aws2026-shared \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides DBPassword=<password>

aws ecr get-login-password --region $REGION | \
  docker login --username AWS --password-stdin $ECR_BASE

docker buildx build --platform linux/amd64 --load \
  -t $ECR_BASE/aws2026/producer:latest producer/
docker buildx build --platform linux/amd64 --load \
  -t $ECR_BASE/aws2026/solution-basic:latest solution-basic/

docker push $ECR_BASE/aws2026/producer:latest
docker push $ECR_BASE/aws2026/solution-basic:latest

aws cloudformation deploy \
  --template-file infra/producer.yml \
  --stack-name aws2026-producer \
  --capabilities CAPABILITY_IAM

aws cloudformation deploy \
  --template-file infra/solution-basic.yml \
  --stack-name aws2026-solution-basic \
  --capabilities CAPABILITY_IAM
```

## Infrastructure overview

All stacks target Free Tier where possible:

| Resource | Type | Notes |
|---|---|---|
| VPC | Public subnets only | No NAT Gateway |
| RDS | `db.t4g.micro`, Single-AZ, 20 GB gp2 | Free Tier |
| EC2 (producer) | `t3.micro`, Ubuntu 24.04 LTS | Free Tier |
| EC2 (processor) | `t3.micro`, Ubuntu 24.04 LTS | Free Tier |
| CloudWatch | Log group `/solution-basic/tasks`, 7-day retention | Free Tier: 5 GB/month |
| ECR | One repo per component, `DeletionPolicy: Retain` | Free Tier: 500 MB/month |
| SSM | `/app/db/user`, `/app/db/password`, Standard tier | Free |

## Progress

- [x] `producer` — Next.js app, Dockerfile, CFN stack, auto-redeploy on ECR push
- [x] `solution-basic` — polling processor, Dockerfile, CFN stack, CloudWatch logging
- [x] `infra/shared.yml` — VPC, RDS, ECR repos, SSM parameters
- [x] `deploy.sh` — unified dev/prod deploy script
- [ ] `solution-kafka` — Lambda functions and Kafka/MSK infrastructure
- [ ] `infra/solution-kafka.yml` — CFN template for the event-driven stack
