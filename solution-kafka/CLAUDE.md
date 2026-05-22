# Kafka Solution Architecture

## Diagram
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
  %% Custom Styles for Nodes
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

  %% Connections
  A -- "Topic Company 1" --> K
  B -- "Topic Company 2" --> K
  C -- "Topic Company 3" --> K
  N -- "Topic Company N" --> K

  SA -- "Logs" --> L
  SB -- "Logs" --> L
  SC -- "Logs" --> L
  SN -- "Logs" --> L

  K -- "Calls SP 1" --> SA
  K -- "Calls SP 2" --> SB
  K -- "Calls SP 3" --> SC
  K -- "Calls SP N" --> SN


```
## Producer (update)

- Producer should handle now 2 different task lists, the existing one to be processed by "Processor", and a new one that should be processed by "Kafka".
- Kafka-processed tasks should have their own form to create those.
- Producer app should use a tab to switch between either list.
- Kafka-processed task should also inform in real time when they are marked as processed.
- "Shipping Company" should be a select, with the options "envia", "inter" and "cordi".
- Once a kafka-processed task is created in DB, it should be sent to the topic with the same value as "Shipping Company"

## Kafka

- Single instance
- Dockerized
- Running on EC2 instance t3.micro

## Lambdas

- Lambda responsibility is to send a message to Cloudwatch with the payload received from Kafka
- All the lambda functions share the same codebase.
- Lambdas should trigger on topics, topics available are 'envia', 'inter', 'cordi'.
