---
name: knowledge-graph
description: provides tools to query and update the project's knowledge graph (brain).
version: 1.0.0
---

# Knowledge Graph Skill

This skill allows the agent to interact with the project's knowledge graph, enabling semantic search, architecture overviews, and symbol tracking.

## Tools

### `query_knowledge_graph`
Searches the knowledge graph for relevant symbols, files, or relationships.
- `query`: The search term or symbol name.

### `update_knowledge_graph`
Triggers an incremental update of the knowledge graph to reflect recent workspace changes.

### `get_architecture_overview`
Returns a high-level overview of the project's structure as seen in the knowledge graph.

### `request_folder_access`
Requests permission to access a folder outside the current workspace.
- `path`: The absolute path to the folder.
- `reason`: The reason why access is needed.
