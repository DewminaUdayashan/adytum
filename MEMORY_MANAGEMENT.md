# Memory Management in Adytum

This document explains how memory is stored, retrieved, and consolidated in Adytum, and how the agent evolves over time using those memories.

## 1) Quick Overview

Adytum uses a **three‑tier memory architecture**:

1. **Short‑Term (Context Window)** — in‑memory recent chat turns.
2. **Episodic (Vector DB / ChromaDB)** — semantic memory of evicted or distilled conversations.
3. **Semantic (SOUL.md + EVOLUTION.md)** — long‑term identity and behavior evolution.

Each tier has a different purpose, retention strategy, and cost profile.

---

## 2) Key Components (Code Entry Points)

- **Short‑Term + Episodic Memory:** `src/agent/memory.py`
- **Agent Core / Memory Injection:** `src/agent/core.py`
- **Memory Tools:** `src/agent/tools.py`
- **Dreamer (Consolidation):** `src/agent/dreamer.py`
- **Inner Monologue (Autonomous Reflection):** `src/agent/inner_monologue.py`
- **Identity Model:** `src/utils/soul.py`
- **Storage + Queues:** `src/utils/database.py`
- **Configuration:** `src/utils/settings.py`

---

## 3) Data Stores & Files

### 3.1 SQLite Database (Operational History)

Located at:

```
data/db/adytum.db
```

Tables that affect memory and evolution:

- `messages` — persistent chat history per session.
- `action_logs` — tool invocation history (used by Dreamer).
- `thought_queue` — surfaced thoughts from Inner Monologue.
- `pending_updates` — approval queue for SOUL/GUIDELINES updates.

### 3.2 ChromaDB Vector Store (Episodic Memory)

Located at:

```
data/db/chroma/
```

Stored as embeddings for semantic retrieval. Used by:

- Context overflow archival.
- Inner Monologue reflection material.
- Dreamer fact embedding.
- User‑requested memory storage (`memory_store`).

### 3.3 Semantic Identity & Evolution Files

Located at:

```
config/personality/SOUL.md
config/personality/EVOLUTION.md
config/personality/GUIDELINES.md
```

- **SOUL.md** — structured identity + system prompt.
- **EVOLUTION.md** — append‑only evolution log.
- **GUIDELINES.md** — behavioral rules from feedback.

### 3.4 Dreamer Snapshots & Archive

Located at:

```
data/memories/snapshots/
data/memories/archive/
```

- Snapshots contain daily summaries.
- Archive stores raw logs as JSON (optional).

---

## 4) Tier 1 — Short‑Term Context Window

**Purpose:** Maintain the last _N_ user+assistant turns for coherent conversation.

**Implementation:** `ContextWindow` in `src/agent/memory.py`.

### How it works

- Default `max_turns = 20` (≈ 40 messages).
- Every new user message is appended.
- When the window exceeds `max_turns`, **oldest messages are evicted** (non‑system).
- Evicted messages are passed to Tier 2 for archival.

### Restore on restart

If the server restarts, the window is re‑seeded from saved DB history if available.

---

## 5) Tier 2 — Episodic Memory (Vector DB / Chroma)

**Purpose:** Keep compressed and searchable history beyond the live window.

**Implementation:** `MemoryStore` in `src/agent/memory.py`.

### Write paths

1. **Context Eviction → Episodic**
   - `archive_evicted_messages()` builds a raw text block.
   - If >200 chars, it is **summarized** using the fast model to reduce token cost.
   - Stored with metadata:
     - `session_id`, `category` (`episodic_raw` or `episodic_summary`), `message_count`, `archived_at`.

2. **User/Agent Memory Tool**
   - Tool: `memory_store` in `src/agent/tools.py`.
   - Stores arbitrary facts with `category` (e.g. preference, task, fact).

3. **Dreamer Fact Embedding**
   - The Dreamer parses summary bullets and writes them as individual facts.
   - Metadata includes `category: dream` and `date`.

4. **Inner Monologue & Curiosity**
   - Monologue reflections and research summaries are stored with categories like
     `monologue` and `curiosity`.

### Read paths

- `memory_search` tool queries ChromaDB using semantic similarity.
- The agent core injects **top‑K relevant memories** into the next user prompt:
  - `_inject_memory_context()` in `src/agent/core.py`.
  - Default `top_k` is configured in settings, but core uses `top_k=3` for injection.

---

## 6) Tier 3 — Semantic Memory (Identity & Evolution)

**Purpose:** Stable long‑term identity and behavioral evolution.

### 6.1 SOUL.md (Identity)

- Structured YAML front‑matter + Markdown body.
- Enforced and validated by `src/utils/soul.py` to prevent corruption.
- Updated through:
  - **User‑requested identity changes** (`update_soul` tool).
  - **Dreamer insights** (queued unless auto‑approved).

### 6.2 GUIDELINES.md (Behavioral Rules)

- Updated through `update_guidelines` tool based on explicit feedback.
- Changes are **queued for approval** unless auto‑approved.

### 6.3 EVOLUTION.md (Observational Journal)

- Written by the Dreamer after each consolidation cycle.
- Append‑only, no approval required.

---

## 7) Consolidation Cycle (Dreamer)

The Dreamer runs on a schedule (default every 30 minutes) via Heartbeat.

**Process:**

1. **Recall** — Fetches `messages` and `action_logs` since last run.
2. **Reflect** — Uses a cheap model to summarize key facts.
3. **Consolidate** —
   - Writes a snapshot to `data/memories/snapshots/YYYY‑MM‑DD.md`.
   - Embeds bullet facts into ChromaDB.
4. **Semantic Update** —
   - Extracts insights for SOUL changes.
   - Queues changes for approval unless auto‑approved.
5. **Prune/Archive** — Optionally archives raw logs to JSON.

This is the main mechanism for **long‑term evolution**.

---

## 8) Autonomous Reflection (Inner Monologue)

The Inner Monologue is a scheduled autonomous cycle that:

- Recalls recent memories from ChromaDB.
- Reflects using a fast model.
- Queues insights for the user (thought queue).
- Writes monologue content and research outcomes back to memory.

It **does not directly change identity**, but it influences the memory reservoir that feeds the Dreamer.

---

## 10) Configuration Knobs

All settings live in:

```
config/settings.yaml
```

Key parameters:

- `memory.collection_name` — Chroma collection name.
- `memory.top_k` — default retrieval count.
- `dreamer.enabled`, `dreamer.interval_minutes` — consolidation schedule.
- `approval.auto_approve_soul`, `approval.auto_approve_guidelines` — approval gate.
- `alive.*` — inner monologue cadence, budget limits, and curiosity.

---

## 11) End‑to‑End Memory Flow (Summary)

1. User message enters agent.
2. Message appended to **Context Window**.
3. If window overflows, evicted messages are summarized and saved to **ChromaDB**.
4. Agent response uses **RAG injection** from ChromaDB for relevance.
5. Dreamer periodically **summarizes the past** and writes:
   - Snapshot files (cold storage).
   - Bullet facts → ChromaDB (episodic).
   - Evolution notes → EVOLUTION.md (semantic).
   - Proposed identity updates → pending approval.
6. Inner Monologue writes **autonomous reflections** back into memory.

---

## 12) Practical Tips

- **To reset memory** safely:
  - Clear ChromaDB (`MemoryStore.clear()`) and delete `data/db/chroma/`.
  - Optionally clear `messages` table in SQLite.
- **To reduce token usage:**
  - Keep `max_turns` smaller.
  - Enable summarization (default behavior).
- **To ensure stability:**
  - Keep auto‑approve disabled for SOUL/GUIDELINES in production.

---

## 13) Key Categories Used in Memory Metadata

Common `category` values stored in ChromaDB:

- `episodic_raw`
- `episodic_summary`
- `dream`
- `monologue`
- `curiosity`
- `general` (default)

These categories are used to filter or reason about memory origin.

---

## 14) Troubleshooting Checklist

- **No memories retrieved:**
  - Ensure ChromaDB folder exists and is writable.
  - Verify `memory.collection_name` matches the stored collection.
  - Check if the memory store count is zero.

- **Dreamer not running:**
  - Ensure `dreamer.enabled = true`.
  - Heartbeat must be running (application lifespan).

- **Identity not updating:**
  - Check the `pending_updates` table for queued changes.
  - Approve via the dashboard if auto‑approve is off.

---

## 15) Architecture Diagram (Conceptual)

```
USER ──► Context Window ──(evict)──► Summarise ──► ChromaDB (Episodic)
  │                                   ▲                │
  │                                   │                │
  └────────────── RAG Injection ◄──────┘                │
  │                                                    │
  └────────────── Dreamer Summary ─────► Snapshots + EVOLUTION + SOUL update queue
```
