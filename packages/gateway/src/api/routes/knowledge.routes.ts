/**
 * @file packages/gateway/src/api/routes/knowledge.routes.ts
 * @description Defines API routes for the knowledge graph.
 */

import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { GraphStore } from '../../domain/knowledge/graph-store.js';
import { GraphIndexer } from '../../domain/knowledge/graph-indexer.js';
import { GraphContext } from '../../domain/knowledge/graph-context.js';
import { loadConfig } from '../../config.js';
import { Workspace, WorkspaceType } from '@adytum/shared';
import { v4 as uuid } from 'uuid';
import { basename } from 'path';

export async function knowledgeRoutes(app: FastifyInstance) {
  const store = container.resolve(GraphStore);
  const indexer = container.resolve(GraphIndexer);
  const context = container.resolve(GraphContext);
  const config = loadConfig();

  /**
   * GET /api/workspaces
   * List all workspaces.
   */
  app.get('/api/workspaces', async () => {
    let workspaces = store.listWorkspaces();
    if (workspaces.length === 0) {
      const defaultWS: Workspace = {
        id: 'default',
        name: 'Adytum (Core)',
        path: config.workspacePath,
        type: 'project',
        nodeCount: 0,
        edgeCount: 0,
        lastIndexed: 0,
        indexingMode: 'fast',
      };
      store.saveWorkspaces([defaultWS]);
      workspaces = [defaultWS];
    }
    return { workspaces };
  });

  /**
   * POST /api/workspaces
   * Create a new workspace.
   */
  app.post('/api/workspaces', async (request) => {
    const { path, name, type } = request.body as {
      path: string;
      name?: string;
      type?: WorkspaceType;
    };
    const id = uuid();
    const wsName = name || basename(path);

    const newWS: Workspace = {
      id,
      name: wsName,
      path,
      type: type || 'project',
      nodeCount: 0,
      edgeCount: 0,
      lastIndexed: 0,
      indexingMode: 'fast',
    };

    const workspaces = store.listWorkspaces();
    workspaces.push(newWS);
    store.saveWorkspaces(workspaces);

    // Trigger initial index
    indexer.update(path, id).catch((err) => {
      app.log.error(err, 'Initial indexing failed');
    });

    return newWS;
  });

  /**
   * DELETE /api/workspaces/:id
   */
  app.delete('/api/workspaces/:id', async (request) => {
    const { id } = request.params as { id: string };
    store.deleteWorkspace(id);
    return { success: true };
  });

  /**
   * GET /api/knowledge/graph
   */
  app.get('/api/knowledge/graph', async (request) => {
    const { workspaceId } = request.query as { workspaceId?: string };
    return store.load(workspaceId);
  });

  /**
   * POST /api/knowledge/reindex
   */
  app.post('/api/knowledge/reindex', async (request) => {
    const { workspaceId } = request.body as { workspaceId?: string };
    const ws = workspaceId ? store.getWorkspace(workspaceId) : null;
    const path = ws ? ws.path : config.workspacePath;

    const graph = await indexer.update(path, workspaceId);
    return { success: true, lastUpdated: graph.lastUpdated, nodeCount: graph.nodes.length };
  });

  /**
   * GET /api/knowledge/query
   */
  app.get('/api/knowledge/query', async (request) => {
    const { q, workspaceId } = request.query as { q?: string; workspaceId?: string };
    if (!q) return { context: '' };
    return { context: context.getRelatedContext(q, workspaceId) };
  });
}
