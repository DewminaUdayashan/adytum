/**
 * @file skills/knowledge-graph/index.ts
 * @description Skill implementation for Knowledge Graph interaction.
 */

import { z } from 'zod';
import { container } from 'tsyringe';
import { GraphContext } from '../../packages/gateway/src/domain/knowledge/graph-context.js';
import { GraphIndexer } from '../../packages/gateway/src/domain/knowledge/graph-indexer.js';
import { PermissionManager } from '../../packages/gateway/src/security/permission-manager.js';
import { GatewayServer } from '../../packages/gateway/src/server.js';

export default {
  tools: [
    {
      name: 'query_knowledge_graph',
      description: 'Searches the knowledge graph for relevant symbols, files, or relationships.',
      parameters: z.object({
        query: z.string().describe('The search term or symbol name.'),
      }),
      async execute({ query }: { query: string }) {
        const context = container.resolve(GraphContext);
        return { result: context.getRelatedContext(query) };
      },
    },
    {
      name: 'update_knowledge_graph',
      description: 'Triggers an incremental update of the knowledge graph.',
      parameters: z.object({}),
      async execute() {
        const indexer = container.resolve(GraphIndexer);
        const graph = await indexer.update();
        return { 
            success: true, 
            message: `Knowledge graph updated. Total nodes: ${graph.nodes.length}`,
            lastUpdated: new Date(graph.lastUpdated).toISOString() 
        };
      },
    },
    {
      name: 'get_architecture_overview',
      description: 'Returns a high-level overview of the projects structure.',
      parameters: z.object({}),
      async execute() {
        const context = container.resolve(GraphContext);
        return { result: context.getArchitectureOverview() };
      },
    },
    {
      name: 'request_folder_access',
      description: 'Requests permission to access a folder outside the current workspace.',
      parameters: z.object({
        path: z.string().describe('The absolute path to the folder.'),
        reason: z.string().describe('The reason why access is needed.'),
      }),
      async execute({ path, reason }: { path: string; reason: string }) {
        const server = container.resolve(GatewayServer);
        const permissionManager = container.resolve(PermissionManager);
        
        // Request manual approval via the gateway
        const approved = await server.requestApproval({
            kind: 'folder_access',
            description: `Agent requested access to: ${path}. Reason: ${reason}`,
            meta: { path, reason }
        });

        if (approved) {
            permissionManager.grantAccess(path, 'full_access');
            return { success: true, message: `Access granted for ${path}` };
        } else {
            return { success: false, message: `Access denied by user for ${path}` };
        }
      },
    }
  ],
};
