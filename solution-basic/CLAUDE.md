# Basic Solution Architecture

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

  %% Connections
  A -->|"Writes"| D
  B -->|"Writes"| D
  N -->|"Writes"| D

  %% Two-way connection for polling
  D <-->|"Reads / Updates"| P
```

## Process Polling

- Small NodeJS application that reads records from the MySQL database, and invokes a task.
- For demo purposes, task objective is to log a simple message into CloudWatch.
