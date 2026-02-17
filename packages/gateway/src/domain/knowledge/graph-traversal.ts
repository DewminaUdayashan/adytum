import { singleton, inject } from 'tsyringe';
import { GraphStore } from './graph-store.js';
import { GraphNode, GraphEdge } from '@adytum/shared';

@singleton()
export class GraphTraversalService {
  constructor(@inject(GraphStore) private graphStore: GraphStore) {}

  /**
   * Gets neighboring nodes for a given node.
   * @param nodeId The ID of the starting node.
   * @param workspaceId The workspace context.
   * @param depth How many hops to traverse (default 1).
   * @returns A list of unique nodes found within the depth.
   */
  getNeighbors(nodeId: string, workspaceId: string, depth: number = 1): GraphNode[] {
    const graph = this.graphStore.load(workspaceId);
    const visited = new Set<string>();
    const result: GraphNode[] = [];
    const queue: { id: string; currentDepth: number }[] = [{ id: nodeId, currentDepth: 0 }];

    visited.add(nodeId);

    while (queue.length > 0) {
      const { id, currentDepth } = queue.shift()!;
      if (currentDepth >= depth) continue;

      // Find outbound edges
      const outbound = graph.edges.filter((e) => e.source === id);
      for (const edge of outbound) {
        if (!visited.has(edge.target)) {
          visited.add(edge.target);
          const node = graph.nodes.find((n) => n.id === edge.target);
          if (node) {
            result.push(node);
            queue.push({ id: edge.target, currentDepth: currentDepth + 1 });
          }
        }
      }

      // Find inbound edges (optional, but good for full context)
      const inbound = graph.edges.filter((e) => e.target === id);
      for (const edge of inbound) {
        if (!visited.has(edge.source)) {
          visited.add(edge.source);
          const node = graph.nodes.find((n) => n.id === edge.source);
          if (node) {
            result.push(node);
            queue.push({ id: edge.source, currentDepth: currentDepth + 1 });
          }
        }
      }
    }

    return result;
  }

  /**
   * Performs a random walk from a starting node.
   * Useful for "wandering" or creative association.
   */
  randomWalk(nodeId: string, workspaceId: string, steps: number = 5): GraphNode[] {
    const graph = this.graphStore.load(workspaceId);
    let currentId = nodeId;
    const path: GraphNode[] = [];

    // Add start node if it exists
    const startNode = graph.nodes.find((n) => n.id === currentId);
    if (startNode) path.push(startNode);

    for (let i = 0; i < steps; i++) {
      // Find all connected nodes
      const edges = graph.edges.filter((e) => e.source === currentId || e.target === currentId);
      if (edges.length === 0) break;

      const randomEdge = edges[Math.floor(Math.random() * edges.length)];
      const nextId = randomEdge.source === currentId ? randomEdge.target : randomEdge.source;

      const nextNode = graph.nodes.find((n) => n.id === nextId);
      if (nextNode) {
        path.push(nextNode);
        currentId = nextId;
      }
    }

    return path;
  }

  /**
   * Finds connections between two nodes (simple BFS for shortest path).
   */
  findPath(startNodeId: string, endNodeId: string, workspaceId: string): string[] | null {
    const graph = this.graphStore.load(workspaceId);
    const queue: { id: string; path: string[] }[] = [{ id: startNodeId, path: [startNodeId] }];
    const visited = new Set<string>([startNodeId]);

    while (queue.length > 0) {
      const { id, path } = queue.shift()!;
      if (id === endNodeId) return path;

      const neighbors: string[] = [];
      graph.edges.filter((e) => e.source === id).forEach((e) => neighbors.push(e.target));
      graph.edges.filter((e) => e.target === id).forEach((e) => neighbors.push(e.source));

      for (const next of neighbors) {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push({ id: next, path: [...path, next] });
        }
      }
    }
    return null;
  }
}
