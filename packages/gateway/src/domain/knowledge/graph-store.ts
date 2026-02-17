/**
 * @file packages/gateway/src/domain/knowledge/graph-store.ts
 * @description Manages the persistence of nodes and edges in the knowledge graph.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { KnowledgeGraph, KnowledgeGraphSchema, Workspace, WorkspaceSchema } from '@adytum/shared';
import { logger } from '../../logger.js';
import { randomUUID } from 'node:crypto';

export class GraphStore {
  private workspacesPath: string;
  private graphsDir: string;

  constructor(private dataPath: string) {
    this.workspacesPath = join(this.dataPath, 'knowledge', 'workspaces.json');
    this.graphsDir = join(this.dataPath, 'knowledge', 'graphs');
    this.ensureDirectories();
  }

  private ensureDirectories() {
    const knowledgeDir = join(this.dataPath, 'knowledge');
    if (!existsSync(knowledgeDir)) mkdirSync(knowledgeDir, { recursive: true });
    if (!existsSync(this.graphsDir)) mkdirSync(this.graphsDir, { recursive: true });
  }

  /**
   * Lists all available workspaces.
   */
  listWorkspaces(): Workspace[] {
    if (!existsSync(this.workspacesPath)) return [];
    try {
      const raw = readFileSync(this.workspacesPath, 'utf-8');
      return JSON.parse(raw);
    } catch (err) {
      logger.error({ err }, 'Failed to load workspaces.');
      return [];
    }
  }

  /**
   * Saves the list of workspaces.
   */
  saveWorkspaces(workspaces: Workspace[]): void {
    writeFileSync(this.workspacesPath, JSON.stringify(workspaces, null, 2), 'utf-8');
  }

  /**
   * Gets a workspace by ID.
   */
  getWorkspace(id: string): Workspace | undefined {
    return this.listWorkspaces().find(w => w.id === id);
  }

  /**
   * Loads the knowledge graph for a specific workspace.
   */
  load(workspaceId?: string): KnowledgeGraph {
    const id = workspaceId || 'default';
    const graphPath = join(this.graphsDir, `graph_${id}.json`);

    if (!existsSync(graphPath)) {
      return {
        nodes: [],
        edges: [],
        lastUpdated: Date.now(),
        version: '1.0.0',
      };
    }

    try {
      const raw = readFileSync(graphPath, 'utf-8');
      const data = JSON.parse(raw);
      return KnowledgeGraphSchema.parse(data);
    } catch (err) {
      logger.error({ err, workspaceId }, 'Failed to load knowledge graph.');
      return {
        nodes: [],
        edges: [],
        lastUpdated: Date.now(),
        version: '1.0.0',
      };
    }
  }

  /**
   * Persists the knowledge graph for a specific workspace.
   */
  save(graph: KnowledgeGraph, workspaceId?: string): void {
    const id = workspaceId || 'default';
    const graphPath = join(this.graphsDir, `graph_${id}.json`);
    
    try {
      writeFileSync(graphPath, JSON.stringify(graph, null, 2), 'utf-8');
      
      // Update workspace stats if it exists
      const workspaces = this.listWorkspaces();
      const ws = workspaces.find(w => w.id === id);
      if (ws) {
          ws.lastIndexed = graph.lastUpdated;
          ws.nodeCount = graph.nodes.length;
          ws.edgeCount = graph.edges.length;
          this.saveWorkspaces(workspaces);
      }
    } catch (err) {
      logger.error({ err, workspaceId }, 'Failed to save knowledge graph.');
      throw new Error(`Persistence failed for workspace ${id}`);
    }
  }

  deleteWorkspace(id: string): void {
      const workspaces = this.listWorkspaces().filter(w => w.id !== id);
      this.saveWorkspaces(workspaces);
      // Optional: delete the graph file
  }
}
