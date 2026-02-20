# Storage and Memory

This document explains persistence, memory flows, and operational data layout.

## 1. Storage Strategy

Adytum supports multiple storage provisioning modes at startup:

1. existing PostgreSQL when `DATABASE_URL` is set
2. Docker-managed PostgreSQL (`pgvector/pgvector:pg17`) when Docker is available
3. SQLite fallback when PostgreSQL is not available

Current runtime behavior relies heavily on SQLite through `MemoryDB` for agent memory, logs, and token analytics.

## 2. Data Directory Layout

Under configured `dataPath` (default: `~/.adytum/data`):

- `sqlite/adytum.db`: operational runtime DB used by `MemoryDB`
- `cron.json`: persisted scheduled jobs
- `security.json`: path whitelist and permission entries
- `secrets.json`: per-skill secrets store
- `memories/snapshots/*.md`: Dreamer periodic memory snapshots
- `cryostasis.json`: dormant agents preserved across gateway restarts
- `graveyard.json`: record of terminated reactive agents

Under workspace:

- `workspace/EVOLUTION.md`: Dreamer appends evolution summaries
- `workspace/SOUL.md`: personality source and update target
- `workspace/HEARTBEAT.md`: heartbeat goals and task context

## 3. SQLite Runtime Tables (`MemoryDB`)

`MemoryDB` creates and maintains these tables:

- `messages`: session messages (user/assistant)
- `memories`: persistent memory entries
- `memories_fts`: FTS5 index (when available) for semantic-ish lookup
- `action_logs`: normalized runtime event logs
- `thought_queue`: queued thoughts
- `token_usage`: token and cost records
- `pending_updates`: queued soul/guideline updates
- `meta`: small key-value metadata (for timestamps, watermarks)

## 4. Agent Persistence & Knowledge Graph

Parallel to the DB, two core structures manage long-term state:

- **AgentRegistry & Cryostasis**: The Swarm lifecycle pushes dormant daemons or scheduled workers into `cryostasis.json` to conserve active memory, thawing them upon demand. Finished workers rest in `graveyard.json` for historical auditing.
- **GraphStore (Knowledge Graph)**: Entity nodes and relational edges are extracted by agents and stored to provide deep structural context across disparate tasks.

## 5. Memory Categories

`MemoryStore` supports categories:

- `episodic_raw`
- `episodic_summary`
- `dream`
- `monologue`
- `curiosity`
- `general`
- `user_fact`

Examples:

- explicit user profile facts -> `user_fact`
- compaction summaries -> `episodic_summary`
- Dreamer insight bullets -> `dream`

## 5. Memory Read/Write Flow

Write path:

1. runtime or tool calls `memoryStore.add(...)`
2. content is sanitized by `redactSecrets`
3. sanitized record is inserted into `memories`
4. FTS index is updated if available

Read path:

1. `memoryStore.search(query, topK)`
2. use FTS match when available, fallback to SQL `LIKE`
3. top records are injected into runtime prompt context

## 6. Token Accounting

`AgentRuntime` records each model call usage via:

- in-memory emitter (`TokenTracker`)
- persistence (`MemoryDB.addTokenUsage`)

Tracked fields include:

- provider, model, modelId, role
- prompt/completion/total tokens
- estimated cost
- timestamp and session ID

Aggregations are exposed via `/api/tokens`.

## 7. Dreamer Persistence Loop

Dreamer periodically:

1. reads recent messages and action logs
2. filters out transient/system noise
3. summarizes meaningful interactions with the model
4. persists bullet insights to memory store (`dream`)
5. writes snapshots to markdown files
6. optionally evolves `SOUL.md`

This creates both structured DB records and human-auditable markdown history.

## 8. Secrets and Sensitive Data Handling

- `MemoryStore` uses redaction patterns before persistence
- `SecretsStore` writes per-skill secrets to `data/secrets.json`
- file permissions are set to `0600` when possible

Important: secrets are currently plaintext at rest in `secrets.json`.

## 9. Data Safety Practices for Contributors

When adding new persistence logic:

1. redact sensitive fields before storing
2. keep schema changes backward compatible where possible
3. avoid storing full transient error traces as long-term memory
4. expose typed query interfaces instead of direct SQL in controllers

## 10. Operational Inspection

Useful inspection points:

- SQL browser against `data/sqlite/adytum.db`
- `/api/tokens` for usage and cost
- `/api/activity` and `/api/logs` for runtime audit stream
- `workspace/EVOLUTION.md` and `data/memories/snapshots` for autonomous summary trail
