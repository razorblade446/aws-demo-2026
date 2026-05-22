# Kafka Broker Spec

Single-node Kafka broker on EC2 using KRaft mode (no Zookeeper). Managed by the Kafka EC2 section of `infra/solution-kafka.yml`.

## Security Group (`KafkaSg`, defined in `infra/shared.yml`)

| Rule | From |
|------|------|
| TCP 9092 inbound | `LambdaSg` (event source polling) |
| TCP 9092 inbound | `ProducerEc2Sg` (producer publishes) |
| TCP 22 inbound | `ProducerEc2Sg` (SSH via bastion) |

## EC2 Instance

| Attribute | Value |
|-----------|-------|
| Instance type | `t3.micro` |
| OS | Amazon Linux 2023 (SSM AMI path) |
| Subnet | `!ImportValue app-PublicSubnetId` |
| EBS | 8 GB gp3 |
| Elastic IP | None — SSH via `app-producer` bastion using `app-key-pair` |
| Key pair | `!ImportValue app-KeyPairName` |

**IAM:**
- `AmazonSSMManagedInstanceCore`
- `s3:GetObject` on `solution-kafka/*` in `ArtifactsBucket`
- `ssm:PutParameter` on `/app/kafka/broker`

**UserData sequence:**
```bash
PRIVATE_IP=$(curl -s http://169.254.169.254/latest/meta-data/local-ipv4)

# Download compose file from S3
mkdir -p /opt/kafka
aws s3 cp s3://<ArtifactsBucket>/solution-kafka/docker-compose.yml /opt/kafka/docker-compose.yml

# Inject private IP for KAFKA_ADVERTISED_LISTENERS substitution
printf 'PRIVATE_IP=%s\n' "${PRIVATE_IP}" > /opt/kafka/.env

# Start broker; kafka-init waits for healthcheck, creates topics, then exits
cd /opt/kafka && docker-compose up -d kafka kafka-init

# Publish broker address to SSM on every boot
aws ssm put-parameter \
  --name /app/kafka/broker \
  --value "${PRIVATE_IP}:9092" \
  --type String \
  --overwrite \
  --region ${AWS::Region}
```

**Outputs:** `KafkaPrivateIp` (export `app-KafkaPrivateIp`), `KafkaInstanceId`

## `docker-compose.yml` Services

| Service | Role |
|---------|------|
| `kafka` | `apache/kafka:3.9.2`; dual-listener: `OUTSIDE` port 9092 advertised as `${PRIVATE_IP}`, `INSIDE` port 9094 for inter-broker; healthcheck on `kafka-cluster.sh cluster-id` |
| `kafka-init` | Same image; `depends_on: kafka: condition: service_healthy`; creates topic `document-bol` then exits |

`PRIVATE_IP` is the only runtime variable, injected by UserData via `/opt/kafka/.env` before `docker-compose up`.

`kafka-ui` and `mysql` services are present in the file for local development only — not started on EC2.

## Topics

| Topic | Consumer |
|-------|---------|
| `document-bol` | `ShippingLambdaBol` (all shipping tasks, regardless of shipper) |

## SSM Parameter + EventBridge Automation

Keeps the producer's `KAFKA_BROKER` in sync whenever the Kafka EC2 reboots or its IP changes, without any CFN cross-stack dependency between `producer.yml` and `solution-kafka.yml`.

**SSM Parameter `KafkaBrokerParam`** (`/app/kafka/broker`)
- Type: String; created in `solution-kafka.yml`
- Initial CFN value: `!Sub '${KafkaInstance.PrivateIp}:9092'`
- Overwritten on every Kafka EC2 boot by the UserData `put-parameter --overwrite` call

**EventBridge Rule `KafkaBrokerChangeRule`**
- Pattern: source `aws.ssm`, detail-type `Parameter Store Change`, `name=/app/kafka/broker`, `operation=Update`
- Target: SSM `AWS-RunShellScript` on the EC2 tagged `Name: app-producer`
- Command run on producer:
  ```bash
  KAFKA_BROKER=$(aws ssm get-parameter --name /app/kafka/broker --query Parameter.Value --output text)
  sed -i "s|^KAFKA_BROKER=.*|KAFKA_BROKER=${KAFKA_BROKER}|" /etc/producer.env
  systemctl restart producer
  ```

**IAM Role `KafkaBrokerEventBridgeRole`:**
- Trust: `events.amazonaws.com`
- `ssm:SendCommand` on `arn:aws:ssm:region::document/AWS-RunShellScript` and `arn:aws:ec2:region:account:instance/*`

> **First-boot:** the SSM parameter is created by CFN before either EC2 boots, so the producer UserData reads the correct initial value immediately. EventBridge handles subsequent Kafka restarts.

## Local Development

Kafka runs via `docker-compose.yml` at the root of the repo:

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
