# solution-kafka — Architecture Spec

## Overview

`solution-kafka` is the event-driven counterpart to `solution-basic`. Instead of polling MySQL, the producer publishes a message to a per-company Kafka topic the moment a task is created. Three AWS Lambda functions — one per topic (`envia`, `inter`, `cordi`) — are triggered by those messages, log the payload to CloudWatch, and mark the task as processed in MySQL.

The producer web app gains a second tab (**Kafka Tasks**) with its own form, table, and real-time SSE notification, backed by a new `kafka_tasks` DB table. The existing **Basic Polling** tab and behaviour are unchanged.

---

## Infrastructure Decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| Kafka hosting | EC2 `t3.micro`, single-node KRaft, Docker Compose | Free Tier; no Zookeeper overhead |
| Kafka listeners | Dual-listener: `OUTSIDE` (port 9092, advertised as EC2 private IP) for Lambda and Producer; `INSIDE` (port 9094) for inter-broker | Producers and consumers reach the broker via the external advertised IP; no public exposure needed |
| Lambda image | Node.js 22.x, `public.ecr.aws/lambda/nodejs:22` base, ECR repo `aws2026/solution-kafka-lambda` | Minimal Lambda base image → smaller pull, faster cold start |
| Kafka runtime | `docker-compose.yml` stored in S3 (`ArtifactsBucket`), downloaded by EC2 on boot; uses `apache/kafka:3.9.2` directly | No custom Docker image or ECR repo needed for the broker |
| Lambda networking | VPC — same VPC, public subnet, dedicated `LambdaSg` | Enables private access to Kafka EC2 and RDS without internet exposure |
| Lambda → CloudWatch | VPC Interface Endpoint for `com.amazonaws.region.logs` | Avoids a NAT gateway (NAT is not Free Tier) |
| Lambda → RDS | Same VPC + `LambdaSg` allowed in `RdsSg` | Private path to RDS; no public DB access from Lambda |
| Event trigger | `AWS::Lambda::EventSourceMapping` (self-managed Kafka) | Native service integration; no polling code required |
| Kafka private IP | Dynamic — assigned by AWS; published to SSM `/app/kafka/broker` on every boot | EventBridge propagates any IP change to the producer automatically |
| Kafka access | SSH via `app-producer` bastion (key pair `app-key-pair`) — no EIP on Kafka | Producer has public IP + port 22 open; Kafka SG only allows SSH from ProducerEc2Sg |
| SSH key pair | Single `AWS::EC2::KeyPair` (`app-key-pair`) created in `app-shared`; private key stored in SSM at `/ec2/keypair/{KeyPairId}` | One key pair for both instances; retrieved once at deploy time |
| `KAFKA_BROKER` distribution | SSM Parameter `/app/kafka/broker`; EventBridge watches for changes and restarts producer | Decouples producer from CFN stack dependency; auto-heals after Kafka restarts |
| Topics | `document-bol` | Single topic for all shipping tasks; created by `kafka-init` on boot |
| Lambda functions | 1 Function, triggers on `document-bol` topic, batches up to 100 messages | All tasks routed through one topic; Lambda logs payload and marks task processed |
| Lambda → RDS | Lambda updates `kafka_tasks.date_processed` | Required for SSE real-time UI feedback |
| `kafka_tasks` table | New table alongside `tasks` | Keeps Kafka tasks separate from polling tasks |

---

## Components

| Component | Dockerfile | ECR Repo | CFN Stack |
|-----------|-----------|----------|-----------|
| Producer (Next.js) | `producer/Dockerfile` | `aws2026/producer` | `infra/producer.yml` |
| Polling Processor | `solution-basic/Dockerfile` | `aws2026/solution-basic` | `infra/solution-basic.yml` |
| Kafka Broker (EC2) | `solution-kafka/kafka/docker-compose.yml` | — (no ECR; uses public `apache/kafka:3.9.2`) | `infra/solution-kafka.yml` |
| Kafka Lambda | `solution-kafka/lambda/Dockerfile` | `aws2026/solution-kafka-lambda` | `infra/solution-kafka.yml` |

---

## CloudFormation Template Layout

```
infra/
├── shared.yml          # VPC, RDS, SGs, SSM params, ECR repos, S3 buckets
│                         MODIFIED: + LambdaSg, + CloudWatchLogsEndpoint, + SolutionKafkaLambdaRepo, + ArtifactsBucket
├── producer.yml        # EC2 t3.micro for Next.js
│                         MODIFIED: + KAFKA_BROKER env var in UserData
├── solution-basic.yml  # EC2 t3.micro for polling processor (unchanged)
└── solution-kafka.yml  # NEW: Kafka EC2, 3 Lambda functions, event source mappings, CW log group
```

---

## Changes to `infra/shared.yml`

### New Resources

| Logical ID | Type | Purpose |
|------------|------|---------|
| `LambdaSg` | `AWS::EC2::SecurityGroup` | Lambda functions — no inbound; outbound to `RdsSg:3306` and implicitly to `KafkaSg:9092` in the same VPC |
| `EndpointSg` | `AWS::EC2::SecurityGroup` | VPC endpoint ENI — inbound 443 from `LambdaSg` |
| `CloudWatchLogsEndpoint` | `AWS::EC2::VPCEndpoint` (Interface) | Lets VPC-attached Lambda write to CloudWatch without a NAT gateway |
| `SolutionKafkaLambdaRepo` | `AWS::ECR::Repository` (`DeletionPolicy: Retain`) | Lambda handler image (`aws2026/solution-kafka-lambda`) |
| `ArtifactsBucket` | `AWS::S3::Bucket` (`DeletionPolicy: Retain`, fully private) | Deploy artifacts; currently holds `solution-kafka/docker-compose.yml` |

### Modified Resources

- **`RdsSg`**: add inbound rule — TCP 3306 from `LambdaSg`. Lambda must update `kafka_tasks.date_processed` in RDS.

### New Stack Outputs

| Output | Export Name | Used By |
|--------|-------------|---------|
| `LambdaSgId` | `app-LambdaSgId` | `solution-kafka.yml` |
| `SolutionKafkaLambdaECRUri` | `app-SolutionKafkaLambdaECRUri` | deploy script |
| `ArtifactsBucketName` | `app-ArtifactsBucketName` | `solution-kafka.yml` KafkaRole + UserData |

---

## `infra/solution-kafka.yml`

### Security Groups

| Logical ID | Rules |
|------------|-------|
| `KafkaSg` | Inbound TCP 9092 from `LambdaSg` (event source polling) and from `ProducerEc2Sg` (producer publishes); inbound TCP 22 from `ProducerEc2Sg` (bastion SSH) |

### Kafka EC2

| Attribute | Value |
|-----------|-------|
| Instance type | `t3.micro` |
| OS | Amazon Linux 2023 (SSM AMI path) |
| Subnet | `!ImportValue app-PublicSubnetId` |
| Security group | `KafkaSg` |
| Private IP | Dynamic (AWS-assigned); resolved at deploy time via `!GetAtt KafkaInstance.PrivateIp` |
| EBS | 8 GB gp3 |
| Elastic IP | None — SSH access via `app-producer` bastion using key pair `app-key-pair` |
| Key pair | `!ImportValue app-KeyPairName` (created in `app-shared`) |
| IAM | `AmazonSSMManagedInstanceCore` + `s3:GetObject` on `solution-kafka/*` in `ArtifactsBucket` + `ssm:PutParameter` on `/app/kafka/broker` |

**UserData** installs Docker and the Compose binary, downloads `docker-compose.yml` from S3, writes `PRIVATE_IP` to `.env`, starts the broker and init services, then writes to SSM:

```bash
PRIVATE_IP=$(curl -s http://169.254.169.254/latest/meta-data/local-ipv4)

# Download compose file from S3
mkdir -p /opt/kafka
aws s3 cp s3://<ArtifactsBucket>/solution-kafka/docker-compose.yml /opt/kafka/docker-compose.yml

# Inject private IP for KAFKA_ADVERTISED_LISTENERS substitution
printf 'PRIVATE_IP=%s\n' "${PRIVATE_IP}" > /opt/kafka/.env

# Start broker; kafka-init waits for healthcheck, then creates topics, then exits
cd /opt/kafka && docker-compose up -d kafka kafka-init

# Publish broker address to SSM on every boot (triggers EventBridge → producer restart)
aws ssm put-parameter \
  --name /app/kafka/broker \
  --value "${PRIVATE_IP}:9092" \
  --type String \
  --overwrite \
  --region ${AWS::Region}
```

**Outputs:** `KafkaPrivateIp` (export `app-KafkaPrivateIp`), `KafkaInstanceId`

### Lambda Functions

Three functions — `ShippingLambdaEnvia`, `ShippingLambdaInter`, `ShippingLambdaCordi` — all backed by the same ECR image (`aws2026/solution-kafka-lambda:latest`).

| Attribute | Value |
|-----------|-------|
| PackageType | `Image` (ECR) |
| Memory | 256 MB |
| Timeout | 30 s |
| VPC SubnetIds | `!ImportValue app-PublicSubnetId` |
| VPC SecurityGroupIds | `!ImportValue app-LambdaSgId` |
| Log group | `/solution-kafka/tasks` (7-day retention, shared by all three) |

**Environment variables set in CFN:**

| Variable | Source |
|----------|--------|
| `DB_HOST` | `!ImportValue app-RDSEndpoint` |
| `DB_PORT` | `!ImportValue app-RDSPort` |
| `DB_NAME` | `producer` (literal) |
| `DB_USER_PARAM` | `!ImportValue app-DBUserParamName` |
| `DB_PASSWORD_PARAM` | `!ImportValue app-DBPasswordParamName` |

### Lambda IAM Role (`LambdaRole`)

Policies attached:
- `AWSLambdaVPCAccessExecutionRole` (managed) — ENI create/describe/delete
- `logs:CreateLogStream`, `logs:PutLogEvents` — scoped to log group ARN
- `ssm:GetParameter` — scoped to `/app/db/user` and `/app/db/password`

### Event Source Mappings

One `AWS::Lambda::EventSourceMapping`:

| Logical ID | Function | Topic |
|------------|----------|-------|
| `EventSourceBol` | `ShippingLambdaBol` | `document-bol` |

Properties:

```yaml
SelfManagedEventSource:
  Endpoints:
    KafkaBootstrapServers:
      - !Sub '${KafkaInstance.PrivateIp}:9092'
SourceAccessConfigurations:
  - Type: VPC_SUBNET
    URI: !Sub 'subnet:${PublicSubnetId}'   # imported
  - Type: VPC_SECURITY_GROUP
    URI: !Sub 'security_group:${LambdaSgId}'  # imported
StartingPosition: LATEST
BatchSize: 100
```

### SSM Parameter + EventBridge Automation

This mechanism keeps the producer's `KAFKA_BROKER` in sync whenever the Kafka EC2 reboots or its IP changes, without any CFN cross-stack dependency between `producer.yml` and `solution-kafka.yml`.

**SSM Parameter `KafkaBrokerParam`** (`/app/kafka/broker`)

- Type: String, created in `solution-kafka.yml`
- Initial CFN value: `!Sub '${KafkaInstance.PrivateIp}:9092'`
- Overwritten on every Kafka EC2 boot by the UserData `aws ssm put-parameter --overwrite` call above

**EventBridge Rule `KafkaBrokerChangeRule`**

- Event pattern: source `aws.ssm`, detail-type `Parameter Store Change`, `detail.name = /app/kafka/broker`, `detail.operation = Update`
- Target: SSM `AWS-RunShellScript` document on the EC2 tagged `Name: app-producer`
- Command executed on producer:
  ```bash
  KAFKA_BROKER=$(aws ssm get-parameter --name /app/kafka/broker --query Parameter.Value --output text)
  sed -i "s|^KAFKA_BROKER=.*|KAFKA_BROKER=${KAFKA_BROKER}|" /etc/producer.env
  systemctl restart producer
  ```

**IAM Role `KafkaBrokerEventBridgeRole`**

- Trust: `events.amazonaws.com`
- Policy: `ssm:SendCommand` on `arn:aws:ssm:region::document/AWS-RunShellScript` and `arn:aws:ec2:region:account:instance/*`

> **First-boot note:** on the first CFN deploy, the Kafka EC2 and Producer EC2 are provisioned in parallel. The producer UserData reads `/app/kafka/broker` from SSM directly — since the SSM parameter is created by CFN before both EC2s boot, the producer gets the correct value immediately. The EventBridge trigger handles subsequent Kafka restarts.

---

## Lambda Handler (`solution-kafka/`)

### Folder Structure

```
solution-kafka/
├── CLAUDE.md
├── SPEC.md
├── kafka/
│   └── docker-compose.yml  ← kafka + kafka-init services; PRIVATE_IP injected from .env on EC2
└── lambda/
    ├── Dockerfile           ← FROM public.ecr.aws/lambda/nodejs:22; minimal size
    ├── package.json
    ├── tsconfig.json
    └── src/
        └── index.ts         ← single handler, shared by all three functions
```

**`kafka/docker-compose.yml`** defines two services used in production; `kafka-ui` and `mysql` are present for local development only and are not started on EC2:

| Service | Role |
|---------|------|
| `kafka` | `apache/kafka:3.9.2`, dual-listener (`OUTSIDE` port 9092 advertised as `${PRIVATE_IP}`, `INSIDE` port 9094 for inter-broker), healthcheck on `kafka-cluster.sh cluster-id` |
| `kafka-init` | Same image; `depends_on: kafka: condition: service_healthy`; creates topic `document-bol` then exits |

`PRIVATE_IP` is the only runtime variable, written to `/opt/kafka/.env` by UserData before `docker-compose up`.

**`lambda/Dockerfile`** uses the slim Lambda base to minimize the pulled layer size:

```dockerfile
FROM public.ecr.aws/lambda/nodejs:22
COPY lambda/package*.json ./
RUN npm ci --only=production
COPY lambda/dist/ ./
CMD ["index.handler"]
```

### Handler Behaviour

The handler receives a `KafkaTriggerEvent` batch. For each record:

1. Decode `value` (Base64) → parse JSON → extract `{ taskId, shipper, product, qty }`.
2. `console.log` the full payload (Lambda forwards stdout to CloudWatch).
3. `UPDATE kafka_tasks SET date_processed = NOW() WHERE id = ?` using RDS credentials fetched from SSM on cold start and cached in module scope.

SSM credentials are fetched once at cold start using the AWS SDK v3 `@aws-sdk/client-ssm`. DB connection uses `mysql2/promise`.

### Environment Variables (Lambda Runtime)

| Variable | Set by |
|----------|--------|
| `::DB_HOST::` | CFN (`!ImportValue app-RDSEndpoint`) |
| `::DB_PORT::` | CFN literal |
| `::DB_NAME::` | CFN literal |
| `::DB_USER_PARAM::` | CFN (`!ImportValue app-DBUserParamName`) |
| `::DB_PASSWORD_PARAM::` | CFN (`!ImportValue app-DBPasswordParamName`) |
| `AWS_REGION` | Lambda runtime (automatic) |

---

## DB Schema Changes

Schema is managed by the application's migration system — not by external scripts, `schema.sql`, or EC2 UserData. Migrations run automatically on every app startup before any request is served.

### Migration system

| File | Role |
|------|------|
| `producer/lib/migrate.ts` | `umzug` instance with a custom mysql2 storage; creates a `migrations` tracking table on first run |
| `producer/instrumentation.ts` | Next.js server lifecycle hook; calls `runMigrations()` on Node.js runtime before the app is ready |
| `producer/migrations/001_create_tasks.sql` | `CREATE TABLE IF NOT EXISTS tasks (…)` |
| `producer/migrations/002_create_kafka_tasks.sql` | `CREATE TABLE IF NOT EXISTS kafka_tasks (…)` |

`umzug` records each applied migration by name in the `migrations` table. On subsequent starts it skips already-applied migrations, so startup is always idempotent regardless of environment.

### `kafka_tasks` table

Created by migration `002`; updated by migration `003`:

```sql
CREATE TABLE IF NOT EXISTS kafka_tasks (
  id              INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  date_created    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  date_processed  DATETIME      NULL,
  shipper         VARCHAR(50)   NOT NULL,
  product         VARCHAR(100)  NOT NULL,
  qty             INT UNSIGNED  NOT NULL DEFAULT 1,
  status          VARCHAR(20)   NOT NULL DEFAULT 'pending',
  PRIMARY KEY (id),
  INDEX idx_kafka_date_processed (date_processed),
  INDEX idx_status (status)
)
```

`status` values: `pending` (inserted, not yet published to Kafka) → `sent` (published successfully). `date_processed` is set by the Lambda consumer and drives the `task_processed` SSE event.

### How migrations reach each environment

| Environment | Mechanism | When |
|-------------|-----------|------|
| **Dev** | `instrumentation.ts` runs on `next dev` startup | Every `pnpm dev` — new migrations applied, already-run ones skipped |
| **Docker (local or EC2)** | `instrumentation.ts` runs on `node server.js` startup; `migrations/` folder is `COPY`-ed into the runner stage of the Dockerfile | Every container start |
| **Production (EC2)** | Same Docker image as above; `producer.yml` UserData only waits for MySQL to be healthy, then starts the container | Every deployment / container restart |

### `producer/db/schema.sql`

Reduced to a single `CREATE DATABASE IF NOT EXISTS producer` statement. This file is bind-mounted into the MySQL docker-compose service via `docker-entrypoint-initdb.d/` so the database exists before the app starts migrations on first boot. Table DDL has been moved entirely to the migration files.

---

## Producer Changes (`producer/`)

### Shared Constants (`lib/constants.ts`)

Defines the canonical shipper and product lists used by both API routes and UI components:

```ts
export const SHIPPERS = [
  { value: 'nakatomi-co',    label: 'Nakatomi Co.'   },
  { value: 'oceanic-air',    label: 'Oceanic Air'    },
  { value: 'wonka-sweets',   label: 'Wonka Sweets'   },
  { value: 'duff-logistics', label: 'Duff Logistics' },
  { value: 'acme-shipping',  label: 'ACME Shipping'  },
] as const;

export const PRODUCTS = [
  { value: 'coca-cola',        label: 'Coca-Cola'        },
  { value: 'pepsi',            label: 'Pepsi'            },
  { value: 'sprite',           label: 'Sprite'           },
  { value: 'fanta-orange',     label: 'Fanta Orange'     },
  { value: 'mountain-dew',     label: 'Mountain Dew'     },
  { value: 'dr-pepper',        label: 'Dr Pepper'        },
  { value: 'root-beer',        label: 'Root Beer'        },
  { value: 'ginger-ale',       label: 'Ginger Ale'       },
  { value: 'club-soda',        label: 'Club Soda'        },
  { value: 'tonic-water',      label: 'Tonic Water'      },
  { value: 'lemonade',         label: 'Lemonade'         },
  { value: 'iced-tea',         label: 'Iced Tea'         },
  { value: 'orange-juice',     label: 'Orange Juice'     },
  { value: 'apple-juice',      label: 'Apple Juice'      },
  { value: 'cranberry-juice',  label: 'Cranberry Juice'  },
  { value: 'sparkling-water',  label: 'Sparkling Water'  },
  { value: 'energy-drink',     label: 'Energy Drink'     },
  { value: 'sports-drink',     label: 'Sports Drink'     },
  { value: 'kombucha',         label: 'Kombucha'         },
  { value: 'coconut-water',    label: 'Coconut Water'    },
] as const;
```

### Updated Types (`lib/types.ts`)

Replace `KafkaTask`:

```ts
export interface KafkaTask {
  id: number;
  date_created: string;
  date_processed: string | null;
  shipper: string;
  product: string;
  qty: number;
  status: 'pending' | 'sent';
}
```

### New Kafka Client (`lib/kafka.ts`)

Singleton `kafkajs` `Producer` initialized lazily on first use. Connects to `process.env.KAFKA_BROKER` (e.g., `10.0.1.10:9092` in production, `localhost:9092` locally). `kafkajs` is already in `package.json`.

### New API Routes

| Route | File | Behaviour |
|-------|------|-----------|
| `GET /api/kafka-tasks` | `app/api/kafka-tasks/route.ts` | `SELECT … FROM kafka_tasks ORDER BY date_created DESC LIMIT 100` |
| `POST /api/kafka-tasks` | same | **Phase 1:** INSERT with `status='pending'`, return row immediately. **Phase 2 (after response via `after()`):** publish to `document-bol` topic; on success, UPDATE `status='sent'` |
| `POST /api/kafka-tasks/generate` | `app/api/kafka-tasks/generate/route.ts` | Accepts `{ count: 10 \| 100 }`. Bulk-inserts N random tasks (`status='pending'`), returns them all, then publishes each to Kafka and flips to `status='sent'` in the background |
| `GET /api/kafka-tasks/sse` | `app/api/kafka-tasks/sse/route.ts` | Polls DB every 2 s. Emits `task_sent` when `status` transitions to `'sent'`; emits `task_processed` when `date_processed` transitions from NULL |

### New UI Components

| Component | Description |
|-----------|-------------|
| `CreateKafkaTaskForm` | MUI `Select` for `shipper` (5 companies) + `Select` for `product` (20 drinks) + `TextField` for `qty`. Three action buttons: **Create Task**, **Generate 10 Tasks**, **Generate 100 Tasks** |
| `KafkaTaskTable` | Columns: `id`, `shipper`, `product`, `qty`, `status` chip (`pending`/`sent`/`processed`), `date_created`, `date_processed` |
| `KafkaTaskDashboard` | State container — fetches initial rows, subscribes to SSE, calls `generate` endpoint for bulk buttons. Handles `task_sent` (silent status update) and `task_processed` (Snackbar notification) |

#### Task status display logic

| `date_processed` | `status` | Chip shown |
|-----------------|---------|------------|
| not null | any | **Processed** (green) |
| null | `sent` | **Sent** (blue) |
| null | `pending` | **Pending** (grey) |

#### 2-phase task creation flow

```
POST /api/kafka-tasks
  → INSERT status='pending'  → return task (UI shows Pending immediately)
  → [after response] publish to document-bol → UPDATE status='sent'
  → SSE emits task_sent → UI updates chip to Sent
  → Lambda processes → UPDATE date_processed → SSE emits task_processed → UI updates chip to Processed + Snackbar
```

### UI Layout (`app/page.tsx`)

Add MUI `Tabs` / `Tab` at the top level:

- **Tab 0 — Basic Polling**: existing `TaskDashboard` (no changes to component)
- **Tab 1 — Kafka**: new `KafkaTaskDashboard`

### New Environment Variable (Producer)

| Variable | Dev default | Production source |
|----------|-------------|------------------|
| `::KAFKA_BROKER::` | `localhost:9092` | Read from SSM `/app/kafka/broker` in `infra/producer.yml` UserData |

### `infra/producer.yml` UserData Change

Add to the section that builds `/etc/producer.env` before starting the container. If the parameter does not exist yet (solution-kafka not yet deployed), fall back to empty so the producer still starts:

```bash
KAFKA_BROKER=$(aws ssm get-parameter \
  --name /app/kafka/broker \
  --region ${AWS::Region} \
  --query Parameter.Value \
  --output text 2>/dev/null || echo "")
```

`producer.yml` requires no cross-stack import from `solution-kafka.yml` — the stacks are fully independent. The EventBridge rule in `solution-kafka.yml` keeps the value live after every Kafka restart.

---

## `docker-compose.yml` Changes

Add a Kafka service for local development:

```yaml
kafka:
  image: apache/kafka:3.9
  ports:
    - "9092:9092"
  environment:
    KAFKA_NODE_ID: 1
    KAFKA_PROCESS_ROLES: broker,controller
    KAFKA_LISTENERS: PLAINTEXT://0.0.0.0:9092,CONTROLLER://0.0.0.0:9093
    KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://localhost:9092
    KAFKA_CONTROLLER_LISTENER_NAMES: CONTROLLER
    KAFKA_CONTROLLER_QUORUM_VOTERS: 1@kafka:9093
    KAFKA_AUTO_CREATE_TOPICS_ENABLE: "true"
    KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 1
```

Set `KAFKA_BROKER=host.docker.internal:9092` when running the producer container locally.

---

## Deployment Flow

### Local Development

```bash
# 1. Start MySQL + Kafka
docker compose up -d

# 1a. Apply schema (automatic on fresh volume; re-run manually if mysql_data already exists)
docker compose exec -T mysql mysql -u admin -ppassword < producer/db/schema.sql

# 2. Build images
docker build -t aws2026/producer:latest producer/
docker build -t aws2026/solution-kafka-lambda:latest -f solution-kafka/lambda/Dockerfile solution-kafka/
# Kafka broker image not needed locally — docker-compose uses apache/kafka:3.9 directly

# 3. Run producer (Kafka-aware)
docker run --rm -p 3000:3000 \
  -e DB_HOST=host.docker.internal \
  -e DB_PORT=3306 \
  -e DB_USER=admin \
  -e DB_PASSWORD=password \
  -e DB_NAME=producer \
  -e KAFKA_BROKER=host.docker.internal:9092 \
  aws2026/producer:latest

# 4. Simulate a Lambda invocation locally
cd solution-kafka/lambda
DB_HOST=localhost DB_PORT=3306 DB_USER=admin DB_PASSWORD=password \
  node -e "require('./dist/index').handler(require('./test/event.json'))"
```

### Production (real AWS)

```bash
export REGION=$(aws configure get region)
export ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
export ECR_BASE=$ACCOUNT.dkr.ecr.$REGION.amazonaws.com

# 1. Deploy shared infrastructure (adds LambdaSg + VPC endpoint)
aws cloudformation deploy \
  --template-file infra/shared.yml \
  --stack-name app-shared \
  --capabilities CAPABILITY_IAM

# 2. Upload Kafka compose file to S3 (must exist before EC2 boots)
ARTIFACTS_BUCKET=$(aws cloudformation list-exports \
  --query "Exports[?Name=='app-ArtifactsBucketName'].Value" --output text)
aws s3 cp solution-kafka/kafka/docker-compose.yml \
  s3://${ARTIFACTS_BUCKET}/solution-kafka/docker-compose.yml

# 3. Build and push Lambda image
aws ecr get-login-password --region $REGION | \
  docker login --username AWS --password-stdin $ECR_BASE
docker buildx build --platform linux/amd64 --load \
  -t $ECR_BASE/aws2026/solution-kafka-lambda:latest \
  solution-kafka/lambda/
docker push $ECR_BASE/aws2026/solution-kafka-lambda:latest

# 4. Deploy solution-kafka (Kafka EC2 + Lambdas)
aws cloudformation deploy \
  --template-file infra/solution-kafka.yml \
  --stack-name app-solution-kafka \
  --capabilities CAPABILITY_IAM

# 5. Redeploy producer to pick up KAFKA_BROKER
aws cloudformation deploy \
  --template-file infra/producer.yml \
  --stack-name app-producer \
  --capabilities CAPABILITY_IAM

# 6. Build and push updated producer image
docker buildx build --platform linux/amd64 --load \
  -t $ECR_BASE/aws2026/producer:latest producer/
docker push $ECR_BASE/aws2026/producer:latest
# (ECR push triggers EventBridge → SSM redeploy automatically)
```

---

## Component Boundaries

| Concern | Owner |
|---------|-------|
| `kafka_tasks` table schema | `producer/migrations/002_create_kafka_tasks.sql` |
| Schema application | `producer/instrumentation.ts` via `umzug` (runs on every app start) |
| Kafka broker EC2 (no EIP) | `infra/solution-kafka.yml` |
| Lambda functions + event source mappings | `infra/solution-kafka.yml` |
| `/app/kafka/broker` SSM parameter | `infra/solution-kafka.yml` |
| EventBridge rule (SSM change → producer restart) + IAM role | `infra/solution-kafka.yml` |
| CloudWatch log group `/solution-kafka/tasks` | `infra/solution-kafka.yml` |
| Lambda SG + VPC endpoint for CW Logs | `infra/shared.yml` |
| Lambda ECR repo (`aws2026/solution-kafka-lambda`) | `infra/shared.yml` |
| S3 artifacts bucket (`ArtifactsBucket`) | `infra/shared.yml` |
| Lambda Dockerfile | `solution-kafka/lambda/Dockerfile` |
| Kafka broker compose | `solution-kafka/kafka/docker-compose.yml` → uploaded to S3 |
| Kafka producer client in Next.js | `producer/lib/kafka.ts` |
| Tab UI, Kafka form + table | `producer/components/` |
| Kafka task API routes + SSE | `producer/app/api/kafka-tasks/` |

---

## Decisions Log

| Question | Decision |
|----------|----------|
| 1 function vs 3 functions | 1 function — all tasks go to `document-bol`; no per-company routing needed |
| Topics | Single `document-bol` topic — all shipping tasks regardless of shipper |
| Task fields | `shipper` (5 fictitious companies), `product` (20 drink names), `qty`, `status` |
| 2-phase creation | Phase 1: INSERT `status='pending'`, return immediately so UI shows Pending; Phase 2: Kafka publish via `after()`, then UPDATE `status='sent'` |
| Bulk generation | `POST /api/kafka-tasks/generate` with `{ count }` — bulk INSERT + background publish |
| Lambda updates RDS | Yes — Lambda sets `date_processed` for real-time SSE feedback |
| KAFKA_BROKER distribution | SSM Parameter Store `/app/kafka/broker`; no CFN cross-stack dependency |
| Kafka EC2 management access | SSH via `app-producer` bastion; `KafkaSg` port 22 allows only `ProducerEc2Sg` |
| Custom Docker image vs Compose for broker | Docker Compose with `apache/kafka:3.9.2` directly — no image build/push pipeline; only the compose file is a deploy artifact, stored in S3 |
