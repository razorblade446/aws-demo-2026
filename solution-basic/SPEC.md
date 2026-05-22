# solution-basic Spec

Node.js polling processor. Reads pending tasks from MySQL every 5 seconds, logs each to CloudWatch, marks them processed. Runs as a Docker container on EC2. Managed by `infra/solution-basic.yml`.

## Stack Resources

**EC2 `t3.micro`**, Ubuntu LTS 24.04:
- UserData: install Docker + AWS CLI v2 → fetch DB credentials from SSM → ECR login → `docker pull aws2026/solution-basic` → `docker run --restart unless-stopped`
- EBS root: 8 GB gp2

**IAM Instance Profile:**
- Managed: `AmazonSSMManagedInstanceCore`
- `ecr:GetAuthorizationToken`, `ecr:BatchGetImage`, `ecr:GetDownloadUrlForLayer`
- `ssm:GetParameter` on `/app/db/user`, `/app/db/password`
- `logs:CreateLogStream`, `logs:PutLogEvents` scoped to `ProcessorLogGroup` ARN

**CloudWatch Log Group** `/solution-basic/tasks` — 7-day retention

**Outputs:** `ProcessorInstanceId`

## Environment Variables

| Variable | Source |
|----------|--------|
| `::DB_HOST::` | CFN cross-stack `app-RDSEndpoint` → EC2 UserData |
| `::DB_PORT::` | CFN cross-stack `app-RDSPort` |
| `::DB_USER::` | SSM `/app/db/user` |
| `::DB_PASSWORD::` | SSM `/app/db/password` (fetched in UserData at boot) |
| `::DB_NAME::` | UserData literal (`producer`) |
| `::POLL_INTERVAL_MS::` | UserData literal (`5000`) |
| `::AWS_REGION::` | EC2 instance metadata (automatic) |
| `::CW_LOG_GROUP::` | UserData literal (`/solution-basic/tasks`) |

## Local Development

```bash
# 1. Start MySQL
docker compose up -d

# 2. Run processor
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

## Component Boundaries

| Concern | Owner |
|---------|-------|
| CloudWatch log group `/solution-basic/tasks` | `infra/solution-basic.yml` |
| EC2 for processor | `infra/solution-basic.yml` |
| `tasks` table schema | `producer/migrations/001_create_tasks.sql` |
| RDS instance + VPC | `infra/shared.yml` |
| EC2 for producer | `infra/producer.yml` |
| ECR repos | `infra/shared.yml` |
