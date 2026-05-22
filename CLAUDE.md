# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Purpose

A demo comparing two approaches to the same business logic — shipping task processing — to illustrate cost and operational differences:

- **solution-basic**: a long-running process that continuously polls a MySQL database for new records and executes tasks.
- **solution-kafka**: an event-driven replacement using a Kafka broker on a VM and AWS Lambda functions triggered by Kafka events.
- **producer**: a Next.js web app that creates tasks in MySQL and shows real-time processing status, used to drive both demos.

## Architecture

### solution-basic — Polling Model

```mermaid
---
config:
  flowchart:
    curve: natural
  theme: base
  themeVariables:
    clusterBkg: "#f8fafc"
    clusterBorder: "#94a3b8"
---
flowchart LR
  classDef api fill:#eff6ff,stroke:#3b82f6,stroke-width:2px,color:#1e3a8a,rx:8px,ry:8px
  classDef db fill:#fef3c7,stroke:#d97706,stroke-width:2px,color:#78350f
  classDef process fill:#f0fdf4,stroke:#22c55e,stroke-width:2px,color:#14532d,rx:8px,ry:8px
  classDef task fill:#f3e8ff,stroke:#a855f7,stroke-width:2px,color:#581c87,rx:8px,ry:8px

  subgraph Producer ["🛒 Merchant App"]
    direction TB
    A["API 1"]:::api
    B["API 2"]:::api
    N["API N"]:::api
  end

  subgraph Storage ["🗄️ Data Layer"]
    direction TB
    D[("Database")]:::db
  end

  subgraph Consumer ["⚙️ Shipping Processor"]
    direction TB
    P["Processor (Polling)"]:::process
    T["Task"]:::task
    L["CloudWatch"]:::db

    P -->|"Spawns"| T
    T -->|"Logs"| L
  end

  A -->|"Writes"| D
  B -->|"Writes"| D
  N -->|"Writes"| D
  D <-->|"Reads / Updates"| P
```

The processor is always on, polling the database in a loop. For demo purposes, each task logs a message to CloudWatch. Cost driver: idle compute time between tasks.

### solution-kafka — Event-Driven Model

```mermaid
---
config:
  flowchart:
    curve: natural
  theme: base
  themeVariables:
    clusterBkg: "#f8fafc"
    clusterBorder: "#94a3b8"
---
flowchart LR
  classDef api fill:#eff6ff,stroke:#3b82f6,stroke-width:2px,color:#1e3a8a,rx:8px,ry:8px
  classDef kafka fill:#fff7ed,stroke:#f97316,stroke-width:2px,color:#9a3412
  classDef process fill:#f0fdf4,stroke:#22c55e,stroke-width:2px,color:#14532d,rx:8px,ry:8px
  classDef db fill:#fef3c7,stroke:#d97706,stroke-width:2px,color:#78350f

  subgraph Producer ["🛒 Merchant App"]
    direction TB
    A["API 1"]:::api
    B["API 2"]:::api
    C["API 3"]:::api
    N["API N"]:::api
  end

  subgraph Broker ["⚡ Event Bus"]
    direction TB
    K{{"Kafka / MSK"}}:::kafka
  end

  subgraph Consumer ["📦 Shipping Processor"]
    direction TB
    SA["Shipping Process 1"]:::process
    SB["Shipping Process 2"]:::process
    SC["Shipping Process 3"]:::process
    SN["Shipping Process N"]:::process
  end

  subgraph Result ["Results registry"]
    L[("CloudWatch")]:::db
  end

  A -- "Topic Company 1" --> K
  B -- "Topic Company 2" --> K
  C -- "Topic Company 3" --> K
  N -- "Topic Company N" --> K

  K -- "Calls SP 1" --> SA
  K -- "Calls SP 2" --> SB
  K -- "Calls SP 3" --> SC
  K -- "Calls SP N" --> SN

  SA -- "Logs" --> L
  SB -- "Logs" --> L
  SC -- "Logs" --> L
  SN -- "Logs" --> L
```

Each merchant API publishes to a per-company Kafka topic. Lambda functions are triggered per topic and execute only when there is work to do, eliminating idle compute and decoupling producers from consumers.

### producer — Web Application

- **Stack**: Next.js + React, Tailwind CSS (utility styling), MUI (layout components), Node.js backend, MySQL, Kafka client.
- **Features**:
  - List tasks with `id`, `date_created`, `date_processed`, `metadata`
  - Create a task (persisted to MySQL)
  - Real-time notification when a task is processed (Kafka consumer or WebSocket push)

## Deployment

### Development

- LocalStack
- awscli-local
- Kafka (EC2)
- MySQL (RDS)
- aws-sam-cli

### Production

- AWS / CloudFormation
- Kafka (EC2 — M7i-flex.large)
- MySQL (RDS — db.t4g.micro)
- awscli

## Development Approach

Before writing or changing code, do a focused review of the existing code and describe how it works. Then produce a concrete plan before making changes. Suggest a small, verifiable step after each discrete change.

When there are choices to make (library, pattern, trade-off), surface them explicitly rather than picking silently. Ask for clarification if anything is unclear or ambiguous before proceeding.

For anything touching input handling, authentication, or external data: perform an additional security review and show reasoning.

Consider operational concerns at every step — how the service is hosted, monitored, and maintained — and flag them where relevant.

When naming something by convention, surround it in double colons and uppercase: `::VARIABLE_NAME::`.

Prefer explanations over code when possible; produce code examples for complex logic or when explicitly asked.

## Commands

```bash
# producer web app
cd producer && npm run dev        # start Next.js dev server
cd producer && npm run build      # production build
cd producer && npm run lint       # ESLint

# solution-basic processor
cd solution-basic && npm start    # start polling processor

# solution-kafka lambdas
cd solution-kafka && npm run deploy  # deploy via SAM/CDK
```
## Non overridable rules

- Use 'pnpm' instead of 'npm'
- Use awscli-local even for development, localstack is already configured on environment, so any infra o service should be created with awscli-local
