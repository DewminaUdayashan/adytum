# Adytum: Technical & Architectural Overview

This document provides a comprehensive technical overview of the Adytum ecosystem, detailing the structural components, the hierarchical swarm logic, memory persistence, LLM orchestration, and event-driven communication.

---

## 1. System Components

The project is structured as a monorepo containing three core packages:

- **`@adytum/gateway` (Backend)**: Built with Node.js and TypeScript, using `tsyringe` for dependency injection. It serves as the "brain," managing LLM routers, specialized agents, memory databases, and skills. It exposes both a REST API and a real-time Socket.IO server.
- **`@adytum/dashboard` (Frontend)**: A Next.js application acting as the control center. It connects to the Gateway to visualize live Swarm metrics, read memory logs, modify model settings, and provide a direct chat interface with active agents.
- **`@adytum/shared` (Shared Logic)**: Defines universal TypeScript types (`AdytumAgent`, `AgentStatus`, `SwarmMessage`) and constants (`SwarmEvents`) used by both the Gateway and the Dashboard.

---

## 2. Hierarchical Swarm Intelligence

Adytum replaces standard single-agent paradigms with an autonomous, multi-tiered agent swarm capable of complex delegation.

### 2.1 Agent Hierarchy

The swarm enforces a strict chain of command to prevent recursion leaks and ensure structured delegation:

- **Tier 1 (The Architect)**: The central overseer (e.g., Prometheus). It manages the overall workspace goal. The Architect is strictly forbidden from spawning low-level workers directly or engaging in heavy parallel tasks itself. It must spawn Tier 2 Managers.
- **Tier 2 (Managers)**: Orchestrators of specific workflows (e.g., "Weather Workflow Manager"). A Manager interprets the Architect's delegation and spawns Tier 3 Workers in parallel batches. Managers are programmatically blocked from spawning other Managers.
- **Tier 3 (Workers)**: Task-specific executors designed to utilize tools and yield results back up the chain.

### 2.2 Swarm Management & Lifecycles

The `SwarmManager` (`swarm-manager.ts`) holds the state of all agents across their lifecycle:

- **Birth**: Triggered by `spawn_swarm_agent`. Agents receive a unique personality and toolset. The tool mandates a required "next step" to delegate a task to the newly spawned agent, ensuring agents aren't just spawned but actively utilized.
- **Cryostasis**: Agents that are `scheduled` or run as `daemons` do not die; instead, they are frozen to a local `cryostasis.json` store when idle, freeing memory. Upon starting the Gateway, these persistent agents are "thawed" into active memory.
- **Death & Graveyard**: Single-run "reactive" agents that complete their tasks are terminated and moved to `graveyard.json`, maintaining historical records without bloating the active registry.

### 2.3 Swarm Communication

Agents do not share a single hive-mind prompt. Instead, they interact via the `SwarmMessenger`.

- **Point-to-Point**: Agents can use the `send_message` tool to transmit queries, reports, or alerts to specific sibling/parent agents.
- **Broadcasting**: Sending a message to the `BOARDCAST` ID distributes the message to all active agents. Agents use `check_inbox` to consume directed messages.

---

## 3. Memory & Knowledge Management

Memory in Adytum is designed for permanence, enabling the swarm to recall past events contextually.

### 3.1 Local Vector Storage (SQLite)

The primary memory mechanism relies on `SqliteMemoryRepository`, wrapping a core `MemoryDB`.

- **Short-Term Logs**: Stores the exact input/output chat history for active sessions.
- **Long-Term Snapshots**: Stores discrete facts and summarized insights. The engine can perform semantic similarity searches (`searchMemories` with Top-K results) when an agent encounters related contexts.

### 3.2 Knowledge Graph

Parallel to vector memory, Adytum builds a relational network of concepts. The `GraphStore` and `GraphIndexer` map entities (people, technologies, tasks) to nodes, establishing edges between them for high-level relationship deduction.

### 3.3 Agent Memory Logging

Each specific agent has an `AgentLogStore` mapping their individual internal monologue ("thoughts"), tool input/outputs, and intermediate findings, keeping debug trails isolated to the specific agent rather than cluttering a global log.

---

## 4. LLM Orchestration & Routing

Adytum abstracts underlying LLM providers (OpenAI, Anthropic, local models) behind a unified, resilient `ModelRouter`.

### 4.1 Role-Based Chain Routing

Rather than hardcoding models (e.g., "use gpt-4"), agents request roles (`thinking`, `fast`, `local`).

- **Model Chains**: Each role corresponds to an ordered array of models defined in the workspace config.
- **Automatic Fallback**: If the primary model in a chain fails (due to API downtime or rate limits), the router automatically re-attempts the prompt with the next model in the chain.

### 4.2 Rate Limiting & Protection

- The router monitors HTTP response codes. Standard 429 quota errors trigger temporary bans (`cooldowns`) on specific models, immediately bypassing them in future checks until the TTL expires.
- **Tier Quotas**: Lower-tier workers (Tier 3) are restricted to shorter fallback chains (max 3 models) compared to Managers/Architects (max 5) to conserve API budgets.

### 4.3 Proxy vs. Direct Access

The Gateway dynamically checks for the presence of a local proxy (like LiteLLM). If detected, it funnels requests via standard OpenAI SDK protocol to the proxy. If not, it falls back to native API wrapper calls directly out to the cloud providers via `LLMClient`.

---

## 5. Event-Driven Backbone

The system relies heavily on decoupled event passing to synchronize the swarm and the frontend UI.

### 5.1 Internal Event Bus

`EventBusService` acts as a central `EventEmitter`.

- Agents use `emit_event` to declare state changes (e.g., "tests:passed").
- Sibling agents use `wait_for_event` to pause their computational loop until the specified event fires, avoiding busy-waiting and conserving tokens.

### 5.2 Real-time Dashboard Sync

The `SocketIOService` bridges internal Gateway events via Websockets. When `SwarmManager` publishes an `AGENT_SPAWNED` or `AGENT_UPDATED` event, the socket pushes it to the Dashboard in real-time. This is what drives the dynamic graph visually expanding as new agents enter the battlefield.

---

## 6. Proactive Subsystems

Adytum instances possess autonomy outside of direct user prompting.

- **CronManager**: Tracks scheduled agent routines, allowing completely disjointed tasks (like daily reports or periodic cleanups) to spawn entirely independently.
- **Inner Monologue / Dreamer**: Idling periods trigger internal self-reflection cycles where the core Architect evaluates its goals, cleans its memory, or generates proactive insights without external stimulation.
- **Sensors**: Background file/system watchers inject events into the bus (e.g., "File changed in `.git`") that the swarm can react to programmatically.
