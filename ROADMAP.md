Roadmap: Elevating Adytum Intelligence & Autonomy
This roadmap outlines the steps to transform Adytum from a "Smart Tool" to a "Cognitive System".

Phase 1: The Semantic Brain (Intelligence)
Goal: Move from "Keyword Search" to "Concept Understanding".

1.1 Vector Embeddings Integration

Action: Add an embedding model (e.g., text-embedding-3-small or local xenova/all-MiniLM-L6-v2) to the ModelRouter.
Action: Update
MemoryDB
schema to support vector columns (using sqlite-vss or migrating to lancedb).
Action: Update MemoryStore.search() to perform hybrid search (Keyword + Vector).
1.2 Knowledge Graph traversals

Action: Implement a "Graph Walker" tool that allows the agent to hop from node to node (e.g., Project -> Related Files -> Authors) to gather context before answering.
1.3 Markdown Knowledge Base ("The Brain")

Action: Create a KnowledgeWatcher service that monitors workspace/knowledge/\*.md.
Action: Automatically embed and index these files into the vector store on save.
Action: Allow the agent to edit these files directly to "learn" new facts permanently (simulating OpenClaw's memory model).

## Phase 2: Autonomous Intelligence (COMPLETED)

- [x] **Task Planner & Orchestrator**: Break goals into actionable DAGs.
- [x] **Parallel Execution**: Execute multiple tool calls concurrently.
- [x] **Error Recovery Engine**: Automated self-correction and retry strategies.
- [x] **Semantic Search**: Vector-based knowledge retrieval.
- [x] **Dashboard Phase 2**: Visualizers for plans, search results, and recovery actions.

## Phase 3: Collaborative Ecosystem (UPCOMING)

- [ ] **Multi-Agent Swarms**: Dynamic spawning and delegation.
- [ ] **Cross-Workspace Knowledge**: Federated indexing across projects.
- [ ] **Real-time Collaboration**: Shared agent sessions and history.
- [ ] **Advanced Skill Evolution**: Self-generating tools and connectors.
      Phase 3: Collaborative Swarm (Multi-Agent)
      Goal: Enable agents to work together without constant micro-management from the root.

  3.1 Peer-to-Peer Messaging

Action: Create a message_agent tool allowing a Tier 3 agent to send a direct package of data to another active Tier 3 agent.
Action: Implement a "Shared Blackboard" (Workspace Memory) where multiple agents can read/write to the same scratchpad simultaneously.
3.2 Dynamic Hierarchy

Action: Allow the system to promote a Tier 2 agent to Tier 1 temporarily for specific domains (e.g., "Davinci" becomes the main agent for a coding session).
Phase 4: Reliability & Trust
Goal: Ensure the system doesn't spiral out of control.

4.1 E2E Agent Testing
Action: Create a test suite that runs a "simulated environment" where agents must solve a puzzle, establishing a benchmark score.
4.2 Budget & Safety Circuit Breakers
4.3 Interactive Onboarding (UX)
Action: Replace
install.sh
with a CLI wizard (ink or prompts) that guides the user through setting up API keys, personality, and initial tools (inspired by openclaw onboard).
