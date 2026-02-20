# Gateway Runtime Internals

This document explains how the gateway runtime behaves during normal operation.

## 1. Core Runtime Objects

Main objects are assembled in `packages/gateway/src/index.ts`:

- `ToolRegistry`: registry and executor for tool definitions
- `ModelRouter`: resolves model chains and executes model calls
- `SkillLoader`: discovers and loads workspace/managed/extra skills
- `SwarmManager`: manages hierarchy (T1/T2/T3), persistence, and lifecycle of agents
- `SwarmMessenger`: handles inter-agent point-to-point and broadcast communication
- `AgentRuntime`: ReAct-style message loop and tool orchestration (per agent)
- `GatewayServer`: Fastify HTTP/WS surface and event broadcasting

Supporting services:

- `PermissionManager`, `SecretsStore`
- `MemoryDB`, `MemoryStore`
- `CronManager`, `Dreamer`, `InnerMonologue`, `HeartbeatManager`

## 2. Agent Loop (`AgentRuntime.run`)

`AgentRuntime` is the central stateful loop for _each individual agent_.

Per agent turn:

1. create trace metadata and emit `trace_start`
2. append user input to context and persistent message log
3. optionally extract user facts into persistent memory
4. optionally retrieve relevant memories (`memoryTopK`) and inject as system context
5. iterate up to `maxIterations`
6. compact context if soft limit is reached
7. call model via `ModelRouter.chat`
8. record token usage and audit entries
9. if tool calls are present:
   - validate and execute each tool through `ToolRegistry`
   - apply approval flow when required
   - append tool results to context
   - continue loop
10. otherwise finalize response, persist assistant message, emit `trace_end`

## 3. Context Management

`ContextManager` holds current session prompt state.

- includes system prompt + rolling message history
- checks for `contextSoftLimit` and triggers compaction
- compaction uses `fast` chain to summarize prior context
- compaction summary can be persisted as memory category `episodic_summary`

## 4. System Prompt Construction

`buildSystemPrompt()` in `AgentRuntime` composes:

- personality from `SoulEngine` (`workspace/SOUL.md`)
- built-in tool guidance and safety/behavior constraints
- dynamic skill instructions from `SkillLoader.getSkillsContext()`

`refreshSystemPrompt()` reloads soul + skill context after updates.

## 5. Tool Execution Path

Tool processing sequence:

1. model emits function/tool call
2. `ToolRegistry` resolves tool by name
3. zod schema validates arguments
4. tool executes and returns result payload
5. runtime writes tool result message into context
6. model receives tool output in next loop iteration

Built-in tools:

- shell execution (`shell_execute`)
- filesystem (`file_read`, `file_write`, `file_list`, `file_search`)
- web fetch (`web_fetch`)
- memory (`memory_store`, `memory_search`, `memory_list`)
- personality update proposals
- cron scheduling
- **Swarm**: `spawn_swarm_agent`, `terminate_agent`, `delegate_task`, `list_agents`
- **Communication**: `send_message`, `check_inbox`
- **Events**: `emit_event`, `wait_for_event`

Skills may register additional tools and long-running services.

## 6. Model Routing Behavior

`ModelRouter` supports:

- chain-based routing by role (`thinking`, `fast`, `local`)
- optional task-level overrides (`taskOverrides`)
- forced direct model selection via `provider/model`
- fallback policies:
  - `fallbackOnRateLimit`
  - `fallbackOnError`
- bounded retries via `routing.maxRetries`

Execution modes:

- via LiteLLM proxy if reachable
- direct provider calls via `LLMClient` if proxy unavailable

## 7. Background Runtime Jobs

### `Dreamer`

- runs on configured interval
- summarizes recent messages and logs
- writes summary snapshots
- stores derived memories (`dream` category)
- may evolve soul content through model-generated patch output

### `InnerMonologue`

- periodic introspection process (similar autonomous reflection loop)

### `HeartbeatManager`

- periodic heartbeat routines tied to goals and status checks

### `CronManager`

- persists jobs in `data/cron.json`
- runs arbitrary scheduled prompts through `AgentRuntime.run`

## 8. Event and Stream Model

Runtime emits events that controllers broadcast over WS:

- `trace_start`, `trace_end`
- `stream` events with `streamType`:
  - `thinking`
  - `status`
  - `tool_call`
  - `tool_result`
  - `response`
- token updates via `TokenTracker`

Audit logs are also emitted and surfaced through APIs.

## 9. Hot Reload Paths

Skill updates can be reloaded without restarting the process:

- filesystem watcher on `workspace/skills`
- `SkillLoader.reload(agent)` refreshes plugin state
- runtime system prompt is rebuilt so new instructions become active

## 10. Operational Debug Tips

- set `DEBUG=1` for richer runtime logs
- inspect `data/sqlite/adytum.db` for persisted runtime evidence
- check `/api/logs` and `/api/activity` for action-level diagnostics
- if skills do not activate, inspect `status`, `error`, and `missing` fields from `/api/skills`
