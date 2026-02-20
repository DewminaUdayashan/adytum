/**
 * @file packages/gateway/src/domain/knowledge/graph-context.ts
 * @description Provides utilities to inject relevant knowledge graph data into the agent's context.
 */

import { KnowledgeGraph, GraphNode } from '@adytum/shared';
import { GraphStore } from './graph-store.js';

export class GraphContext {
  constructor(private store: GraphStore) {}

  /**
   * Retrieves relevant nodes and edges for a given query or symbol.
   */
  getRelatedContext(query: string, workspaceId?: string): string {
    const graph = this.store.load(workspaceId);
    const queryLower = query.toLowerCase();

    // Find nodes that match the query
    const relevantNodes = graph.nodes.filter(
      (n) =>
        n.label.toLowerCase().includes(queryLower) ||
        n.path?.toLowerCase().includes(queryLower) ||
        n.description?.toLowerCase().includes(queryLower),
    );

    if (relevantNodes.length === 0) {
      return this.getArchitectureOverview(workspaceId);
    }

    let context = `[Knowledge Graph Search Results in Workspace "${workspaceId || 'default'}" for "${query}"]\n`;

    // Limit to top 10 relevant nodes to avoid context overflow
    relevantNodes.slice(0, 10).forEach((node) => {
      context += `- ${node.type.toUpperCase()}: ${node.label} (${node.path || node.id})\n`;
      if (node.description) context += `  Description: ${node.description}\n`;

      // Find immediate connections (1-hop)
      const edges = graph.edges.filter((e) => e.source === node.id || e.target === node.id);
      if (edges.length > 0) {
        context += `  Connections:\n`;
        edges.slice(0, 5).forEach((edge) => {
          const isSource = edge.source === node.id;
          const otherId = isSource ? edge.target : edge.source;
          const otherNode = graph.nodes.find((n) => n.id === otherId);
          if (otherNode) {
            const rel = isSource ? `-> ${edge.type} ->` : `<- ${edge.type} <-`;
            context += `    ${rel} ${otherNode.label} (${otherNode.type})\n`;
          }
        });
      }
    });

    return context;
  }

  /**
   * Returns a high-level summary of the entire graph for architecture overviews.
   */
  getArchitectureOverview(workspaceId?: string): string {
    const graph = this.store.load(workspaceId);
    const directories = graph.nodes.filter((n) => n.type === 'directory');
    const mainFiles = graph.nodes.filter(
      (n) => n.type === 'file' && !n.path?.includes('node_modules'),
    );

    let overview = `[Architecture Overview for Workspace "${workspaceId || 'default'}"]\n`;
    overview += `Total Nodes: ${graph.nodes.length} | Total Edges: ${graph.edges.length}\n`;
    overview += `Key Directories:\n`;
    directories.slice(0, 10).forEach((d) => {
      overview += `- ${d.path}\n`;
    });

    return overview;
  }
}
