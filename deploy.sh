#!/usr/bin/env bash
# deploy.sh — Deploy all stacks to dev (LocalStack) or prod (AWS).
#
# Usage:
#   ./deploy.sh dev                                # DB password defaults to 'changeme123'
#   ./deploy.sh prod --db-password <password>      # or set DB_PASSWORD env var
#
set -euo pipefail

# ── colour helpers ─────────────────────────────────────────────────────────────
CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
RED='\033[0;31m'; BOLD='\033[1m'; RESET='\033[0m'

step()  { echo -e "\n${BOLD}${CYAN}▶  $*${RESET}"; }
ok()    { echo -e "${GREEN}✔  $*${RESET}"; }
warn()  { echo -e "${YELLOW}⚠  $*${RESET}"; }
die()   { echo -e "${RED}✘  $*${RESET}" >&2; exit 1; }

# cfn_deploy — wraps `$CLI cloudformation deploy` and treats "no changes" as success.
cfn_deploy() {
  local output exit_code=0
  output=$($CLI cloudformation deploy "$@" 2>&1) || exit_code=$?
  if [[ $exit_code -ne 0 ]] && echo "$output" | grep -qi "no changes to deploy\|up to date"; then
    warn "No changes — stack already up to date."
  elif [[ $exit_code -ne 0 ]]; then
    echo "$output" >&2
    return $exit_code
  else
    echo "$output"
  fi
}

banner() {
  echo -e "\n${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  echo -e "${BOLD}  $*${RESET}"
  echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}\n"
}

# ── usage ──────────────────────────────────────────────────────────────────────
usage() {
  echo "Usage: $0 <dev|prod> [--db-password <password>]"
  echo ""
  echo "  dev   LocalStack (awslocal). DB password defaults to 'changeme123'."
  echo "        EC2 stacks are skipped — run apps locally with pnpm instead."
  echo "  prod  Real AWS. Requires DB_PASSWORD env var or --db-password flag."
  echo ""
  echo "Environment variables:"
  echo "  DB_PASSWORD  Database password (alternative to --db-password)"
  exit 1
}

# ── parse args ─────────────────────────────────────────────────────────────────
ENV="${1:-}"
[[ "$ENV" == "dev" || "$ENV" == "prod" ]] || usage
shift

DB_PASSWORD="${DB_PASSWORD:-}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --db-password) DB_PASSWORD="$2"; shift 2 ;;
    -h|--help)     usage ;;
    *) die "Unknown argument: $1"; usage ;;
  esac
done

# ── environment setup ──────────────────────────────────────────────────────────
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "$ENV" == "dev" ]]; then
  CLI="awslocal"
  REGION="us-east-1"
  ECR_BASE="172.30.150.234:4510"
  DB_PASSWORD="${DB_PASSWORD:-changeme123}"
else
  CLI="aws"
  REGION="$(aws configure get region 2>/dev/null || echo "")"
  [[ -n "$REGION" ]] || die "AWS region not configured. Run: aws configure set region <region>"
  ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
  ECR_BASE="${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com"
  [[ -n "$DB_PASSWORD" ]] || \
    die "DB_PASSWORD is required for prod. Set the env var or pass --db-password."
fi

banner "Deploy  ·  env=${CYAN}${ENV}${RESET}${BOLD}  ·  region=${REGION}  ·  ecr=${ECR_BASE}"

# ── step 1: shared stack (VPC + RDS + ECR repos + SSM params) ─────────────────
step "[1/4] Deploying shared stack (VPC, RDS, ECR repos, SSM params)"

cfn_deploy \
  --template-file "$REPO_ROOT/infra/shared.yml" \
  --stack-name app-shared \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides "DBPassword=${DB_PASSWORD}"

ok "Shared stack deployed."

# ── step 2: build Docker images ───────────────────────────────────────────────
step "[2/4] Building Docker images"

docker build --platform linux/amd64 \
  -t "${ECR_BASE}/aws2026/producer:latest" \
  "$REPO_ROOT/producer"

docker build --platform linux/amd64 \
  -t "${ECR_BASE}/aws2026/solution-basic:latest" \
  "$REPO_ROOT/solution-basic"

# Lambda image: compile TypeScript first, then build the container
pnpm --dir "$REPO_ROOT/solution-kafka/lambda" build

docker build --platform linux/amd64 \
  -t "${ECR_BASE}/aws2026/solution-kafka-lambda:latest" \
  -f "$REPO_ROOT/solution-kafka/lambda/Dockerfile" \
  "$REPO_ROOT/solution-kafka/lambda"

ok "Images built."

# ── step 3: push to ECR ───────────────────────────────────────────────────────
step "[3/4] Pushing images to ECR (${ECR_BASE})"

$CLI ecr get-login-password --region "$REGION" | \
  docker login --username AWS --password-stdin "$ECR_BASE"

docker push "${ECR_BASE}/aws2026/producer:latest"
docker push "${ECR_BASE}/aws2026/solution-basic:latest"
docker push "${ECR_BASE}/aws2026/solution-kafka-lambda:latest"

ok "Images pushed."

# ── step 4: app stacks ────────────────────────────────────────────────────────
if [[ "$ENV" == "prod" ]]; then
  step "[4/4] Deploying producer, solution-basic, and solution-kafka stacks"

  # Upload Kafka docker-compose.yml to S3 before deploying solution-kafka.
  # The Kafka EC2 UserData fetches this file at boot to start the broker.
  ARTIFACTS_BUCKET=$($CLI cloudformation describe-stacks \
    --stack-name app-shared \
    --query 'Stacks[0].Outputs[?OutputKey==`ArtifactsBucketName`].OutputValue' \
    --output text)

  $CLI s3 cp "$REPO_ROOT/solution-kafka/kafka/docker-compose.yml" \
    "s3://${ARTIFACTS_BUCKET}/solution-kafka/docker-compose.yml"

  ok "Kafka docker-compose.yml uploaded to s3://${ARTIFACTS_BUCKET}/solution-kafka/"

  cfn_deploy \
    --template-file "$REPO_ROOT/infra/producer.yml" \
    --stack-name app-producer \
    --capabilities CAPABILITY_IAM

  cfn_deploy \
    --template-file "$REPO_ROOT/infra/solution-basic.yml" \
    --stack-name app-solution-basic \
    --capabilities CAPABILITY_IAM

  cfn_deploy \
    --template-file "$REPO_ROOT/infra/solution-kafka.yml" \
    --stack-name app-solution-kafka \
    --capabilities CAPABILITY_IAM

  PRODUCER_URL=$($CLI cloudformation describe-stacks \
    --stack-name app-producer \
    --query 'Stacks[0].Outputs[?OutputKey==`ProducerURL`].OutputValue' \
    --output text)

  ok "All stacks deployed."
  banner "${GREEN}Deploy complete!${RESET}${BOLD}  Producer → ${CYAN}${PRODUCER_URL}"

else
  step "[4/4] Skipping EC2/Lambda stacks — LocalStack does not execute UserData or self-managed Kafka triggers"
  warn "Run the apps locally instead:"
  echo -e "  Producer:   ${CYAN}cd producer && pnpm dev${RESET}         # http://localhost:3000"
  echo -e "  Processor:  ${CYAN}cd solution-basic && pnpm start${RESET}"
  echo ""
  banner "${GREEN}Infrastructure ready!${RESET}${BOLD}  LocalStack ECR: ${CYAN}${ECR_BASE}"
fi
