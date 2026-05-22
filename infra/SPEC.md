# Shared Infrastructure Spec

Managed by `infra/shared.yml`. All other stacks import from this one.

## Infrastructure Decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| EC2 instance type | `t3.micro` | Better baseline than t2 at similar Free Tier cost |
| EC2 OS | Ubuntu LTS 24.04 | AMI resolved via SSM at deploy time |
| EC2 EBS volume | 8 GB gp2 | Free Tier: 30 GB total across instances |
| RDS instance type | `db.t4g.micro`, Single-AZ | Free Tier: 750 hrs/month |
| RDS storage | 20 GB gp2 | Free Tier limit |
| ECR repos | One per component | Free Tier: 500 MB/month — use multi-stage builds |
| VPC topology | Public subnets only | No NAT Gateway (not Free Tier) |
| Lambda → CloudWatch | VPC Interface Endpoint | Avoids NAT gateway |
| SSH key pair | Single `AWS::EC2::KeyPair` | One key for both instances; private key in SSM |

## VPC + Networking

- **VPC** — two public subnets in separate AZs (required for RDS subnet group)
- **Internet Gateway** + public route table attached to both subnets
- No private subnets, no NAT gateway

## Security Groups

| Logical ID | Inbound | Outbound |
|------------|---------|----------|
| `RdsSg` | TCP 3306 from `ProducerEc2Sg`, `ProcessorEc2Sg`, `LambdaSg` | — |
| `ProducerEc2Sg` | TCP 80 from internet; TCP 22 from internet (bastion) | to `RdsSg` |
| `ProcessorEc2Sg` | none | to `RdsSg`, CloudWatch |
| `LambdaSg` | none | to `RdsSg:3306` (implicitly to `KafkaSg:9092` in VPC) |
| `EndpointSg` | TCP 443 from `LambdaSg` | — |
| `KafkaSg` | TCP 9092 from `LambdaSg`, `ProducerEc2Sg`; TCP 22 from `ProducerEc2Sg` | — |

`KafkaSg` is defined in `infra/shared.yml` and exported; used by `infra/solution-kafka.yml`.

## RDS MySQL

- Engine: MySQL, `db.t4g.micro`, Single-AZ
- Storage: 20 GB gp2
- Publicly accessible: yes (protected by `RdsSg` — only EC2 SGs are allowed in)
- DB name: `producer`

## SSM Parameters

| Parameter | Type | Purpose |
|-----------|------|---------|
| `/app/db/user` (`::DB_USER_PARAM::`) | String (Standard) | DB username |
| `/app/db/password` (`::DB_PASSWORD_PARAM::`) | String (Standard) | DB password |

Both are Standard tier (free). Set at stack creation via `DBPassword` parameter override.

## Key Pair

- `AWS::EC2::KeyPair` named `app-key-pair`
- Private key stored by AWS in SSM at `/ec2/keypair/{KeyPairId}` — retrieve once after deploy
- Used by both Producer EC2 (bastion) and Kafka EC2

## ECR Repositories

All have `DeletionPolicy: Retain` — survive stack deletes.

| Repo name | Used by |
|-----------|---------|
| `aws2026/producer` | Producer EC2 |
| `aws2026/solution-basic` | Polling processor EC2 |
| `aws2026/solution-kafka-lambda` | Lambda function |

## S3 Artifacts Bucket

- `DeletionPolicy: Retain`, fully private
- Holds `solution-kafka/docker-compose.yml` — downloaded by Kafka EC2 on boot

## VPC Interface Endpoint

- Service: `com.amazonaws.{region}.logs`
- Subnet: `PublicSubnetId`; SG: `EndpointSg`
- Lets VPC-attached Lambda write to CloudWatch without a NAT gateway

## Stack Outputs (Cross-Stack Exports)

| Output | Export Name | Used By |
|--------|-------------|---------|
| `VpcId` | `app-VpcId` | producer.yml, solution-basic.yml |
| `PublicSubnetId` | `app-PublicSubnetId` | producer.yml, solution-basic.yml, solution-kafka.yml |
| `PublicSubnet2Id` | `app-PublicSubnet2Id` | RDS subnet group (requires two AZs) |
| `RdsSgId` | `app-RdsSgId` | producer.yml, solution-basic.yml |
| `ProducerEc2SgId` | `app-ProducerEc2SgId` | producer.yml, solution-kafka.yml |
| `ProcessorEc2SgId` | `app-ProcessorEc2SgId` | solution-basic.yml |
| `LambdaSgId` | `app-LambdaSgId` | solution-kafka.yml |
| `KafkaSgId` | `app-KafkaSgId` | solution-kafka.yml |
| `RDSEndpoint` | `app-RDSEndpoint` | producer.yml, solution-basic.yml, solution-kafka.yml |
| `RDSPort` | `app-RDSPort` | producer.yml, solution-basic.yml, solution-kafka.yml |
| `DBUserParamName` | `app-DBUserParamName` | producer.yml, solution-basic.yml, solution-kafka.yml |
| `DBPasswordParamName` | `app-DBPasswordParamName` | producer.yml, solution-basic.yml, solution-kafka.yml |
| `KeyPairName` | `app-KeyPairName` | solution-kafka.yml |
| `SolutionKafkaLambdaECRUri` | `app-SolutionKafkaLambdaECRUri` | deploy script |
| `ArtifactsBucketName` | `app-ArtifactsBucketName` | solution-kafka.yml |
