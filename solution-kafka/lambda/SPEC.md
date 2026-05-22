# Lambda Consumer Spec

Five Lambda functions sharing one codebase, each triggered by the `document-bol` Kafka topic filtered to a specific shipper. Each function logs the full message payload to its own CloudWatch log group and marks the task processed in MySQL. All managed by the Lambda section of `infra/solution-kafka.yml`.

## Functions

One function per shipper. All share the same ECR image (`app-SolutionKafkaLambdaECRUri`), memory, timeout, VPC config, IAM role, and environment variables. Only the log group and event source filter differ.

| Logical ID | Shipper Filter | Log Group |
|---|---|---|
| `ShippingLambdaNakatomiCo` | `nakatomi-co` | `/solution-kafka/nakatomi-co` |
| `ShippingLambdaOceanicAir` | `oceanic-air` | `/solution-kafka/oceanic-air` |
| `ShippingLambdaWonkaSweets` | `wonka-sweets` | `/solution-kafka/wonka-sweets` |
| `ShippingLambdaDuffLogistics` | `duff-logistics` | `/solution-kafka/duff-logistics` |
| `ShippingLambdaAcmeShipping` | `acme-shipping` | `/solution-kafka/acme-shipping` |

**Common attributes:**

| Attribute | Value |
|---|---|
| PackageType | `Image` — URI built with `!Sub '${Uri}:latest'` where `Uri: !ImportValue app-SolutionKafkaLambdaECRUri` (ECR `RepositoryUri` exports the bare URI without a tag; Lambda requires a tag or digest) |
| Memory | 256 MB |
| Timeout | 30 s |
| VPC SubnetIds | `!ImportValue app-PublicSubnetId` |
| VPC SecurityGroupIds | `!ImportValue app-LambdaSgId` |
| Log retention | 7 days |

## Event Source Mappings

Each function has its own `AWS::Lambda::EventSourceMapping` on the `document-bol` topic with a shipper-specific filter. Lambda decodes the Base64 message value before applying the filter, so the pattern matches directly on the JSON payload field.

```yaml
EventSourceNakatomiCo:
  Type: AWS::Lambda::EventSourceMapping
  Properties:
    FunctionName: !Ref ShippingLambdaNakatomiCo
    SelfManagedEventSource:
      Endpoints:
        KafkaBootstrapServers:
          - !Sub '${KafkaInstance.PrivateIp}:9092'
    SourceAccessConfigurations:
      - Type: VPC_SUBNET
        URI: !Sub
          - 'subnet:${SubnetId}'
          - SubnetId: !ImportValue app-PublicSubnetId
      - Type: VPC_SECURITY_GROUP
        URI: !Sub
          - 'security_group:${SgId}'
          - SgId: !ImportValue app-LambdaSgId
    StartingPosition: LATEST
    BatchSize: 50
    Topics:
      - document-bol
    FilterCriteria:
      Filters:
        - Pattern: '{"value":{"shipper":["nakatomi-co"]}}'
```

## IAM Role (`LambdaRole`)

Shared by all five functions.

- Managed: `AWSLambdaVPCAccessExecutionRole` (ENI create/describe/delete, `ec2:DescribeSubnets`)
- `logs:CreateLogStream`, `logs:PutLogEvents` — scoped to `/solution-kafka/*`
- `ssm:GetParameter` — scoped to `/app/db/user`, `/app/db/password`
- `ec2:DescribeSecurityGroups`, `ec2:DescribeVpcs` — resource `*` (required for VPC attachment; **not** included in `AWSLambdaVPCAccessExecutionRole` and must be granted explicitly or Lambda returns a 400 on the event source mapping)

## Environment Variables

| Variable | Source |
|---|---|
| `::DB_HOST::` | `!ImportValue app-RDSEndpoint` |
| `::DB_PORT::` | `3306` (literal) |
| `::DB_NAME::` | `producer` (literal) |
| `::DB_USER_PARAM::` | `!ImportValue app-DBUserParamName` |
| `::DB_PASSWORD_PARAM::` | `!ImportValue app-DBPasswordParamName` |
| `AWS_REGION` | Lambda runtime (automatic) |

## Handler Behaviour (`solution-kafka/lambda/src/index.ts`)

Receives a `KafkaTriggerEvent` batch (up to 50 records). For each record:
1. Decode `value` (Base64) → parse JSON → extract `{ taskId, shipper, product, qty }`
2. `console.log` the full payload — forwarded to the function's CloudWatch log group by the Lambda runtime
3. `UPDATE kafka_tasks SET date_processed = NOW() WHERE id = ?`

SSM credentials are fetched once at cold start and cached in module scope. DB connection uses `mysql2/promise`.

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
RUN corepack enable && corepack prepare pnpm
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY dist/ ./
CMD ["index.handler"]
```

## Local Testing

```bash
cd solution-kafka/lambda
DB_HOST=localhost DB_PORT=3306 DB_USER=admin DB_PASSWORD=password \
  node -e "require('./dist/index').handler(require('./test/event.json'))"
```
