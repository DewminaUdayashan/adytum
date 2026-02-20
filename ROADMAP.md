# Adytum Roadmap: Autonomous Swarm & Hierarchy

## Phase 1: The Swarm Core (Backend)

_Objective: Enable the Main Agent (Architect) to spawn, manage, and kill sub-processes with persistent identity._

- [x] **Swarm Manager Class**: Implement a singleton `SwarmManager` to handle the lifecycle of all agents.
- [x] **Identity Generation**: Integrate `unique-names-generator` (or LLM-based naming) and DiceBear API for agent persona creation.
- [x] **Context Isolation**: Ensure each spawned agent has its own isolated `memory` array and `system_prompt` but shares the main `workspace` directory.
- [x] **The Graveyard**: Implement a soft-delete mechanism. Deactivated agents are serialized to a `graveyard.json` or database for historical review.

## Phase 2: Communication & Orchestration

_Objective: Enable "Intelligent Handoffs" between agents._

- [x] **Inter-Agent Protocol (IAP)**: A structured JSON schema for agents to pass tasks (`{ to: agentId, instruction: string, context: object }`).
- [x] **Hierarchical Logging**: Update the Socket.io emitter to tag every log chunk with an `agentId` so the frontend can route it to the correct UI card.
- [x] **Supervisor Loop**: The Architect must have a "listening" state to receive reports from active Managers before marking a main task as complete.

## Phase 3: The Dashboard (Frontend)

_Objective: Visualize the Swarm._

- [x] **Live Hierarchy View**: A tree visualization (e.g., using `react-flow` or D3) showing the Architect -> Managers -> Workers.
- [x] **Agent Detail Modal**: Clicking an agent node opens a modal showing:
  - Avatar & Name
  - Current "Thought" (Stream)
  - Active Tool usage
  - Parent ID
- [x] **The Graveyard Tab**: A list view of "Dead" agents with their final reports and lifetime stats.

## Phase 4: Persistence & Recurring Workflows

- [x] **Cryostasis**: Agents marked as `recurring` are serialized to disk (JSON) when idle and re-hydrated by Cron jobs.
- [x] **Skill Inheritance**: Allow the Architect to pass specific subsets of its tools to sub-agents (e.g., a "Researcher" gets _only_ `web_search`, not `file_write`).

## Phase 5: Advanced Intelligence & Hierarchy (Completed)

- [x] **Automated Tiering**: Sub-agents now automatically inherit `Parent Tier + 1`. This ensures Architect (T1) -> Manager (T2) -> Worker (T3) relationships.
- [x] **Manager Persona (T2)**: Tier 2 agents receive a "Manager Preamble" instructing them to break down missions and delegate to Tier 3 workers.
- [x] **Batch Spawning**: `spawn_swarm_agent` now supports a `count` parameter for efficient parallel spawning of workers.

## Phase 6: Unified Swarm Scheduling & Reliability (Completed)

- [x] **Targeted Cron Jobs**: `CronManager` can now target specific sub-agents by ID.
- [x] **Autonomous Registration**: When you spawn an agent with `mode="scheduled"`, `SwarmManager` automatically registers it in the system's cron engine.
- [x] **Tool Inheritance**: Sub-agents inherit tools required for communication (e.g., Discord) if specified.

## Next: Phase 7 - Future Expansions

- [ ] **Collaborative Planning**: Agents can propose sub-plans to the Architect.
- [ ] **Cross-Swarm Memory**: Shared vector store for knowledge retrieval across agents.
- [ ] **Dynamic Tool Learning**: Agents can write their own tools and share them.
