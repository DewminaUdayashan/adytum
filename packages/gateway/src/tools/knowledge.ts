import { z } from 'zod';
import { ToolDefinition } from '@adytum/shared';
import { GraphTraversalService } from '../domain/knowledge/graph-traversal.js';
import { GraphIndexer } from '../domain/knowledge/graph-indexer.js';

const KnowledgeWalkSchema = z.object({
  startNodeId: z.string().optional().describe('The ID of the node to start traversal from.'),
  query: z
    .string()
    .optional()
    .describe('Search term to find a starting node if startNodeId is unknown.'),
  depth: z.number().min(1).max(3).default(1).describe('How many hops to traverse (1-3).'),
  workspaceId: z.string().optional().describe('The workspace context.'),
});

/**
 * Creates knowledge tools.
 */
export function createKnowledgeTools(
  traversalService: GraphTraversalService,
  indexer: GraphIndexer,
): ToolDefinition[] {
  return [
    {
      name: 'knowledge_walk',
      description:
        'Explore the knowledge graph starting from a specific node or topic to find related concepts, dependencies, or connections.',
      parameters: KnowledgeWalkSchema,
      execute: async (args: z.infer<typeof KnowledgeWalkSchema>) => {
        const { startNodeId, query, depth, workspaceId } = args;
        const wsId = workspaceId || 'default';

        let startId = startNodeId;

        if (!startId && query) {
          const nodes = traversalService.findNodesByQuery(query, wsId, 1);
          if (nodes.length === 0) {
            return {
              result: `Could not find any nodes matching query '${query}'.`,
              isError: false,
            };
          }
          startId = nodes[0].id;
        }

        if (!startId) {
          return {
            result: "Please provide a 'startNodeId' or 'query' to begin the walk.",
            isError: true,
          };
        }

        try {
          const neighbors = traversalService.getNeighbors(startId, wsId, depth);

          if (neighbors.length === 0) {
            return { result: `No connections found for node '${startId}' within depth ${depth}.` };
          }

          const formatted = neighbors
            .map((n: any) => `- [${n.type}] ${n.label} (ID: ${n.id})`)
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
    {
      name: 'knowledge_index',
      description:
        'Trigger a re-index of the knowledge graph. Use "deep" mode for semantic analysis and vector store ingestion.',
      parameters: z.object({
        mode: z
          .enum(['fast', 'deep'])
          .default('fast')
          .describe('Fast only updates the graph structure. Deep performs semantic analysis.'),
        skipSummaries: z
          .boolean()
          .default(true)
          .describe(
            'If true, skips expensive LLM summaries while still performing local vector indexing during deep mode.',
          ),
        workspaceId: z.string().optional().describe('The workspace context.'),
      }),
      execute: async (args: any) => {
        const { mode, workspaceId, skipSummaries } = args as {
          mode: 'fast' | 'deep';
          workspaceId?: string;
          skipSummaries: boolean;
        };
        const wsId = workspaceId || 'default';
        try {
          const graph = await indexer.update(undefined, wsId, { mode, skipLLM: skipSummaries });
          return {
            result: `Indexing [${mode}] completed (skipSummaries: ${skipSummaries}). Graph now contains ${graph.nodes.length} nodes and ${graph.edges.length} edges.`,
            status: 'success',
          };
        } catch (error: any) {
          return { result: `Failed to index: ${error.message}`, isError: true };
        }
      },
    },
  ];
}
