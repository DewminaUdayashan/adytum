/**
 * @file packages/gateway/src/domain/knowledge/graph-context.ts
 * @description Provides utilities to inject relevant knowledge graph data into the agent's context.
 */

import { GraphNode } from '@adytum/shared';
import { MemoryStore } from '../../infrastructure/repositories/memory-store.js';
import { GraphStore } from './graph-store.js';

export class GraphContext {
  constructor(
    private store: GraphStore,
    private memoryStore: MemoryStore,
  ) {}

  /**
   * Retrieves relevant nodes and edges for a given query or symbol.
   */
  async getRelatedContext(query: string, workspaceId?: string): Promise<string> {
    const graph = this.store.load(workspaceId);
    if (!graph) return this.getArchitectureOverview(workspaceId);

    const queryLower = query.toLowerCase();

    // 1. Semantic/Hybrid Search from Memory (superior to simple graph filter)
    let hybridMemories: any[] = [];
    try {
      hybridMemories = await this.memoryStore.searchHybrid(query, 5, {
        category: 'doc_chunk',
        workspaceId,
      });
    } catch (err) {
      console.error('[GraphContext] Hybrid search failed:', err);
    }

    // 2. Fallback/Supplement: Find nodes that match the query in the graph
    const relevantNodes = graph.nodes.filter(
      (n: GraphNode) =>
        n.label.toLowerCase().includes(queryLower) ||
        n.path?.toLowerCase().includes(queryLower) ||
        n.description?.toLowerCase().includes(queryLower),
    );

    if (hybridMemories.length === 0 && relevantNodes.length === 0) {
      return this.getArchitectureOverview(workspaceId);
    }

    let context = `[Knowledge Context for "${query}" in Workspace "${workspaceId || 'default'}"]\n\n`;

    if (hybridMemories.length > 0) {
      context += `## Relevant Documentation & Code Chunks:\n`;
      hybridMemories.forEach((m) => {
        context += `### ${m.source} (${m.category})\n${m.content}\n---\n`;
      });
    }

    if (relevantNodes.length > 0) {
      context += `\n## Structural Reference (Code Graph):\n`;
      // Limit to top 5 relevant nodes to avoid context overflow
      relevantNodes.slice(0, 5).forEach((node: GraphNode) => {
        context += `- ${node.type.toUpperCase()}: ${node.label} (${node.path || node.id})\n`;
        if (node.description) context += `  Description: ${node.description}\n`;

        // Find immediate connections (1-hop)
        const edges = graph.edges.filter((e: any) => e.source === node.id || e.target === node.id);
        if (edges.length > 0) {
          context += `  Connections:\n`;
          edges.slice(0, 3).forEach((edge: any) => {
            const isSource = edge.source === node.id;
            const otherId = isSource ? edge.target : edge.source;
            const otherNode = graph.nodes.find((n: GraphNode) => n.id === otherId);
            if (otherNode) {
              const rel = isSource ? `-> ${edge.type} ->` : `<- ${edge.type} <-`;
              context += `    ${rel} ${otherNode.label} (${otherNode.type})\n`;
            }
          });
        }
      });
    }

    return context;
  }

  /**
   * Returns a high-level summary of the entire graph for architecture overviews.
   */
  getArchitectureOverview(workspaceId?: string): string {
    const graph = this.store.load(workspaceId);
    if (!graph || !graph.nodes) return '[Knowledge Graph is empty or not loaded]';

    const directories = graph.nodes.filter((n: GraphNode) => n.type === 'directory');
    const mainFiles = graph.nodes.filter(
      (n: GraphNode) => n.type === 'file' && !n.path?.includes('node_modules'),
    );

    let overview = `[Architecture Overview for Workspace "${workspaceId || 'default'}"]\n`;
    overview += `Total Nodes: ${graph.nodes.length} | Total Edges: ${graph.edges.length}\n`;
    overview += `Key Directories:\n`;
    directories.slice(0, 10).forEach((d: GraphNode) => {
      overview += `- ${d.path}\n`;
    });

    return overview;
  }
}
