# Producer Spec

Next.js web app that creates shipping tasks and shows real-time processing status. Managed by `infra/producer.yml`.

## EC2 Stack (`infra/producer.yml`)

- `t3.micro`, Ubuntu LTS 24.04 (`{{resolve:ssm:/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id}}`)
- EBS root: 8 GB gp2
- Host port 80 → container port 3000 (`-p 80:3000`)
- Elastic IP for stable public address

**UserData sequence:**
1. Install Docker + AWS CLI v2 + mysql client
2. Fetch DB credentials from SSM (`/app/db/user`, `/app/db/password`)
3. Read `KAFKA_BROKER` from SSM `/app/kafka/broker` (falls back to empty if solution-kafka not deployed)
4. Wait for RDS health check
5. Write `/etc/producer.env` with all env vars
6. ECR login → `docker pull aws2026/producer:latest`
7. Install and start `producer.service` (systemd)

**IAM Instance Profile:**
- Managed: `AmazonSSMManagedInstanceCore`
- `ecr:GetAuthorizationToken`, `ecr:BatchGetImage`, `ecr:GetDownloadUrlForLayer`
- `ssm:GetParameter` on `/app/db/user`, `/app/db/password`, `/app/kafka/broker`
- `ssm:SendCommand` for EventBridge-triggered redeploy

**EventBridge auto-redeploy:** `ProducerRedeployRule` watches for `ECR Image Action / PUSH` on `aws2026/producer:latest` and triggers `AWS-RunShellScript` on the producer EC2 to pull and restart.

**Outputs:** `ProducerPublicIP`, `ProducerURL`

## Environment Variables

| Variable | Dev default | Production source |
|----------|-------------|------------------|
| `DB_HOST` | `host.docker.internal` | CFN cross-stack `app-RDSEndpoint` |
| `DB_PORT` | `3306` | CFN cross-stack `app-RDSPort` |
| `DB_USER` | `admin` | SSM `/app/db/user` |
| `DB_PASSWORD` | `password` | SSM `/app/db/password` (fetched in UserData) |
| `DB_NAME` | `producer` | UserData literal |
| `::KAFKA_BROKER::` | `localhost:9092` | SSM `/app/kafka/broker` |

## DB Migrations

Managed by `umzug` (`producer/lib/migrate.ts`). Runs automatically on every app start via `producer/instrumentation.ts` (Next.js server lifecycle hook). Idempotent — already-applied migrations are skipped.

| Migration | Table |
|-----------|-------|
| `001_create_tasks.sql` | `tasks` (polling tasks) |
| `002_create_kafka_tasks.sql` | `kafka_tasks` |

`producer/db/schema.sql` contains only `CREATE DATABASE IF NOT EXISTS producer` — bind-mounted into the MySQL docker-compose service on first boot.

### `kafka_tasks` schema

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

`status` flow: `pending` → `sent` (published to Kafka) → `date_processed` set by Lambda.

## API Routes

| Route | File | Behaviour |
|-------|------|-----------|
| `GET /api/tasks` | `app/api/tasks/route.ts` | List polling tasks |
| `POST /api/tasks` | same | Insert polling task |
| `GET /api/tasks/sse` | `app/api/tasks/sse/route.ts` | SSE: emits `task_processed` |
| `GET /api/kafka-tasks` | `app/api/kafka-tasks/route.ts` | `SELECT … FROM kafka_tasks ORDER BY date_created DESC LIMIT 100` |
| `POST /api/kafka-tasks` | same | INSERT `status='pending'`, return row; then via `after()`: publish to `document-bol`, UPDATE `status='sent'` |
| `POST /api/kafka-tasks/generate` | `app/api/kafka-tasks/generate/route.ts` | Bulk INSERT N tasks, publish each to Kafka in background |
| `GET /api/kafka-tasks/sse` | `app/api/kafka-tasks/sse/route.ts` | Polls DB every 2 s; emits `task_sent` and `task_processed` |

### 2-phase Kafka task creation

```
POST /api/kafka-tasks
  → INSERT status='pending'  → return task (UI shows Pending)
  → [after()] publish to document-bol → UPDATE status='sent'
  → SSE task_sent → UI chip: Sent
  → Lambda processes → UPDATE date_processed → SSE task_processed → UI chip: Processed + Snackbar
```

## UI Components

| Component | Description |
|-----------|-------------|
| `CreateKafkaTaskForm` | MUI Select for `shipper` + Select for `product` + TextField for `qty`; buttons: Create Task, Generate 10, Generate 100 |
| `KafkaTaskTable` | Columns: `id`, `shipper`, `product`, `qty`, status chip, `date_created`, `date_processed` |
| `KafkaTaskDashboard` | State container; fetches rows, subscribes to SSE, handles `task_sent` and `task_processed` |

**Tab layout (`app/page.tsx`):** Tab 0 — Basic Polling (existing `TaskDashboard`); Tab 1 — Kafka (`KafkaTaskDashboard`).

**Status chip logic:**

| `date_processed` | `status` | Chip |
|-----------------|---------|------|
| not null | any | Processed (green) |
| null | `sent` | Sent (blue) |
| null | `pending` | Pending (grey) |

## Shared Constants (`lib/constants.ts`)

- `SHIPPERS`: 5 fictitious companies (`nakatomi-co`, `oceanic-air`, `wonka-sweets`, `duff-logistics`, `acme-shipping`)
- `PRODUCTS`: 20 drink names (`coca-cola`, `pepsi`, … `coconut-water`)

## Kafka Client (`lib/kafka.ts`)

Singleton `kafkajs` Producer, initialized lazily. Connects to `process.env.KAFKA_BROKER`.

## Local Development

```bash
# 1. Start MySQL + Kafka
docker compose up -d

# 2. Run producer
docker run --rm -p 3000:3000 \
  -e DB_HOST=host.docker.internal \
  -e DB_PORT=3306 \
  -e DB_USER=admin \
  -e DB_PASSWORD=password \
  -e DB_NAME=producer \
  -e KAFKA_BROKER=host.docker.internal:9092 \
  aws2026/producer:latest
```
