# Architecture Spec

Demo comparing two approaches to shipping task processing on AWS.

## Solutions

| Solution | Model | Consumer | Cost Driver |
|----------|-------|----------|-------------|
| solution-basic | Polling | EC2 always-on process | Idle compute |
| solution-kafka | Event-driven | Kafka EC2 → Lambda | Pay-per-invocation |

Both share the same MySQL database (RDS) and producer web app.

## CFN Template Layout

```
infra/
├── shared.yml          # VPC, RDS, SGs, SSM params, ECR repos, S3 bucket, key pair
├── producer.yml        # EC2 t3.micro for Next.js app
├── solution-basic.yml  # EC2 t3.micro for polling processor, CW log group
└── solution-kafka.yml  # Kafka EC2, Lambda function, event source mapping, CW log group
```

## Child SPECs

| Scope | File |
|-------|------|
| Shared infrastructure | [infra/SPEC.md](infra/SPEC.md) |
| Producer web app | [producer/SPEC.md](producer/SPEC.md) |
| Polling processor | [solution-basic/SPEC.md](solution-basic/SPEC.md) |
| Kafka broker (EC2) | [solution-kafka/kafka/SPEC.md](solution-kafka/kafka/SPEC.md) |
| Lambda consumer | [solution-kafka/lambda/SPEC.md](solution-kafka/lambda/SPEC.md) |

## Production Deployment

### Prerequisites

```bash
export REGION=$(aws configure get region)
export ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
export ECR_BASE=$ACCOUNT.dkr.ecr.$REGION.amazonaws.com

aws ecr get-login-password --region $REGION | \
  docker login --username AWS --password-stdin $ECR_BASE
```

### solution-basic

```bash
# 1. Shared infrastructure (VPC, RDS, ECR repos, SSM params, key pair)
aws cloudformation deploy \
  --template-file infra/shared.yml \
  --stack-name app-shared \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides DBPassword=<your-password>

# 2. Build and push images
docker buildx build --platform linux/amd64 --load -t $ECR_BASE/aws2026/producer:latest producer/
docker buildx build --platform linux/amd64 --load -t $ECR_BASE/aws2026/solution-basic:latest solution-basic/
docker push $ECR_BASE/aws2026/producer:latest
docker push $ECR_BASE/aws2026/solution-basic:latest

# 3. Deploy stacks
aws cloudformation deploy --template-file infra/producer.yml \
  --stack-name app-producer --capabilities CAPABILITY_IAM

aws cloudformation deploy --template-file infra/solution-basic.yml \
  --stack-name app-solution-basic --capabilities CAPABILITY_IAM
```

### solution-kafka (additional steps after solution-basic)

```bash
# 4. Upload Kafka compose file to S3
ARTIFACTS_BUCKET=$(aws cloudformation list-exports \
  --query "Exports[?Name=='app-ArtifactsBucketName'].Value" --output text)
aws s3 cp solution-kafka/kafka/docker-compose.yml \
  s3://${ARTIFACTS_BUCKET}/solution-kafka/docker-compose.yml

# 5. Build and push Lambda image
docker buildx build --platform linux/amd64 --load \
  -t $ECR_BASE/aws2026/solution-kafka-lambda:latest \
  solution-kafka/lambda/
docker push $ECR_BASE/aws2026/solution-kafka-lambda:latest

# 6. Deploy Kafka stack
aws cloudformation deploy \
  --template-file infra/solution-kafka.yml \
  --stack-name app-solution-kafka \
  --capabilities CAPABILITY_IAM

# 7. Redeploy producer to pick up KAFKA_BROKER from SSM
aws cloudformation deploy \
  --template-file infra/producer.yml \
  --stack-name app-producer \
  --capabilities CAPABILITY_IAM
```
