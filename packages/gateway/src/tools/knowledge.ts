import { z } from 'zod';
import { ToolDefinition } from '@adytum/shared';
import { GraphTraversalService } from '../domain/knowledge/graph-traversal.js';

const KnowledgeWalkSchema = z.object({
  startNodeId: z.string().optional().describe('The ID of the node to start traversal from.'),
  query: z
    .string()
    .optional()
    .describe('Search term to find a starting node if startNodeId is unknown.'),
  depth: z.number().min(1).max(3).default(1).describe('How many hops to traverse (1-3).'),
  workspaceId: z.string().optional().describe('The workspace context.'),
});

export function createKnowledgeTools(traversalService: GraphTraversalService): ToolDefinition[] {
  return [
    {
      name: 'knowledge_walk',
      description:
        'Explore the knowledge graph starting from a specific node or topic to find related concepts, dependencies, or connections.',
      parameters: KnowledgeWalkSchema,
      execute: async (args: z.infer<typeof KnowledgeWalkSchema>) => {
        const { startNodeId, query, depth, workspaceId } = args;
        const wsId = workspaceId || 'default';

        const startId = startNodeId;

        // If no start ID, try to find one via query (we'd need a search method, but for now we rely on strict ID or maybe random walk if supported)
        // For this iteration, we assume strict ID or we fail if query is provided but no search service is injected here yet.
        // Actually, let's just support startNodeId for now to keep it simple as per plan.

        if (!startId && query) {
          // TODO: Implement search-to-node resolution using embedding search or simple graph scan
          return {
            result: `Search by query '${query}' not yet implemented. Please provide a valid 'startNodeId'.`,
            isError: true,
          };
        }

        if (!startId) {
          return {
            result: "Please provide a 'startNodeId' to begin the walk.",
            isError: true,
          };
        }

        try {
          const neighbors = traversalService.getNeighbors(startId, wsId, depth);

          if (neighbors.length === 0) {
            return { result: `No connections found for node '${startId}' within depth ${depth}.` };
          }

          const formatted = neighbors
            .map((n) => `- [${n.type}] ${n.label} (ID: ${n.id})`)
            .join('\n');
          return {
            result: `Found ${neighbors.length} connected nodes from '${startId}' (depth ${depth}):\n${formatted}`,
          };
        } catch (error: any) {
          return {
            result: `Failed to walk graph: ${error.message}`,
            isError: true,
          };
        }
      },
    },
  ];
}
