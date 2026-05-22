# Lambda Consumer Spec

Single Lambda function triggered by Kafka messages on the `document-bol` topic. Logs the payload to CloudWatch and marks the task processed in MySQL. Managed by the Lambda section of `infra/solution-kafka.yml`.

## Function

| Attribute | Value |
|-----------|-------|
| Logical ID | `ShippingLambdaBol` |
| PackageType | `Image` (ECR: `aws2026/solution-kafka-lambda:latest`) |
| Memory | 256 MB |
| Timeout | 30 s |
| VPC SubnetIds | `!ImportValue app-PublicSubnetId` |
| VPC SecurityGroupIds | `!ImportValue app-LambdaSgId` |
| Log group | `/solution-kafka/tasks` (7-day retention) |

## Event Source Mapping

```yaml
EventSourceBol:
  Type: AWS::Lambda::EventSourceMapping
  Properties:
    FunctionName: !Ref ShippingLambdaBol
    SelfManagedEventSource:
      Endpoints:
        KafkaBootstrapServers:
          - !Sub '${KafkaInstance.PrivateIp}:9092'
    SourceAccessConfigurations:
      - Type: VPC_SUBNET
        URI: !Sub 'subnet:${PublicSubnetId}'
      - Type: VPC_SECURITY_GROUP
        URI: !Sub 'security_group:${LambdaSgId}'
    StartingPosition: LATEST
    BatchSize: 100
    Topics:
      - document-bol
```

## IAM Role (`LambdaRole`)

- Managed: `AWSLambdaVPCAccessExecutionRole` (ENI create/describe/delete)
- `logs:CreateLogStream`, `logs:PutLogEvents` — scoped to log group ARN
- `ssm:GetParameter` — scoped to `/app/db/user`, `/app/db/password`

## Environment Variables

| Variable | Source |
|----------|--------|
| `::DB_HOST::` | `!ImportValue app-RDSEndpoint` |
| `::DB_PORT::` | literal |
| `::DB_NAME::` | `producer` (literal) |
| `::DB_USER_PARAM::` | `!ImportValue app-DBUserParamName` |
| `::DB_PASSWORD_PARAM::` | `!ImportValue app-DBPasswordParamName` |
| `AWS_REGION` | Lambda runtime (automatic) |

## Handler Behaviour (`solution-kafka/lambda/src/index.ts`)

Receives a `KafkaTriggerEvent` batch. For each record:
1. Decode `value` (Base64) → parse JSON → extract `{ taskId, shipper, product, qty }`
2. `console.log` the full payload (forwarded to CloudWatch by Lambda runtime)
3. `UPDATE kafka_tasks SET date_processed = NOW() WHERE id = ?`

SSM credentials are fetched once at cold start via AWS SDK v3 `@aws-sdk/client-ssm` and cached in module scope. DB connection uses `mysql2/promise`.

## Folder Structure

```
solution-kafka/lambda/
├── Dockerfile
├── package.json
├── tsconfig.json
└── src/
    └── index.ts
```

## Dockerfile

```dockerfile
FROM public.ecr.aws/lambda/nodejs:22
COPY lambda/package*.json ./
RUN npm ci --only=production
COPY lambda/dist/ ./
CMD ["index.handler"]
```

Uses the slim Lambda base image to minimize pull size and cold start.

## Local Testing

```bash
cd solution-kafka/lambda
DB_HOST=localhost DB_PORT=3306 DB_USER=admin DB_PASSWORD=password \
  node -e "require('./dist/index').handler(require('./test/event.json'))"
```
