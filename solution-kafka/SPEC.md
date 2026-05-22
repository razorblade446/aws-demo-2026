# solution-kafka Spec

Event-driven counterpart to `solution-basic`. When a task is created, the producer publishes a message to the `document-bol` Kafka topic. A Lambda function consumes the message, logs the payload to CloudWatch, and marks the task processed in MySQL.

## Sub-SPECs

| Component | File |
|-----------|------|
| Kafka broker (EC2) | [kafka/SPEC.md](kafka/SPEC.md) |
| Lambda consumer | [lambda/SPEC.md](lambda/SPEC.md) |

## CFN Stack (`infra/solution-kafka.yml`)

Provisions:
- `KafkaSg` security group
- Kafka EC2 instance — see [kafka/SPEC.md](kafka/SPEC.md)
- `LambdaRole` IAM role (shared by all five functions)
- Five CloudWatch log groups — `/solution-kafka/<shipper>`, 7-day retention
- Five Lambda functions (`ShippingLambda*`) — same ECR image, one per shipper
- Five event source mappings on `document-bol` topic, filtered by shipper, batch size 50
- `KafkaBrokerParam` SSM parameter + `KafkaBrokerChangeRule` EventBridge rule

## Component Boundaries

| Concern | Owner |
|---------|-------|
| Kafka broker EC2 | `infra/solution-kafka.yml` |
| Lambda functions + event source mappings | `infra/solution-kafka.yml` |
| `/app/kafka/broker` SSM parameter | `infra/solution-kafka.yml` |
| EventBridge rule (SSM change → producer restart) | `infra/solution-kafka.yml` |
| CloudWatch log groups `/solution-kafka/<shipper>` (×5) | `infra/solution-kafka.yml` |
| `LambdaSg` + VPC endpoint for CW Logs | `infra/shared.yml` |
| Lambda ECR repo (`aws2026/solution-kafka-lambda`) | `infra/shared.yml` |
| S3 artifacts bucket | `infra/shared.yml` |
| `kafka_tasks` table schema | `producer/migrations/002_create_kafka_tasks.sql` |
| Kafka producer client + API routes + UI | `producer/` |
