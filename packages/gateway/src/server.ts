import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import cors from '@fastify/cors';
import { EventEmitter } from 'node:events';
import type { WebSocket } from 'ws';
import { type AdytumConfig, serializeFrame, type WebSocketFrame } from '@adytum/shared';
import crypto from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { execFile } from 'node:child_process';

import { errorHandler } from './api/middleware/error.middleware.js';
import { modelRoutes } from './api/routes/model.routes.js';
import { skillRoutes } from './api/routes/skill.routes.js';
import { configRoutes } from './api/routes/config.routes.js';
import { healthRoutes } from './api/routes/health.routes.js';
import { agentRoutes } from './api/routes/agent.routes.js';
import { systemRoutes } from './api/routes/system.routes.js';
import { taskRoutes } from './api/routes/task.routes.js';

import { tokenTracker } from './domain/logic/token-tracker.js';
import { auditLogger } from './security/audit-logger.js';
import { loadConfig, saveConfig } from './config.js';
import { container } from 'tsyringe';
import { AgentController } from './api/controllers/agent.controller.js';
import { ApprovalService } from './domain/logic/approval-service.js';

import type { SecretsStore } from './security/secrets-store.js';
import type { PermissionManager } from './security/permission-manager.js';
import type { HeartbeatManager } from './application/services/heartbeat-manager.js';
import type { CronManager } from './application/services/cron-manager.js';
import type { SkillLoader } from './application/services/skill-loader.js';
import type { ToolRegistry } from './tools/registry.js';
import type { MemoryDB } from './infrastructure/repositories/memory-db.js';
import type { ModelCatalog } from './infrastructure/llm/model-catalog.js';

export interface ServerConfig {
  port: number;
  host: string;
  permissionManager?: PermissionManager;
  workspacePath?: string;
  heartbeatManager?: HeartbeatManager;
  cronManager?: CronManager;
  skillLoader?: SkillLoader;
  toolRegistry?: ToolRegistry;
  memoryDb?: MemoryDB;
  modelCatalog?: ModelCatalog;
  secretsStore?: SecretsStore;
  onScheduleUpdate?: (type: 'dreamer' | 'monologue', intervalMinutes: number) => void;
  onSkillsReload?: () => Promise<void>;
  onChainsUpdate?: (chains: Record<string, string[]>) => void;
  onRoutingUpdate?: (routing: AdytumConfig['routing']) => void;
}

/**
 * Gateway Server — Fastify + WebSocket.
 * Manages client connections, routes messages to the agent runtime,
 * and streams events back to connected clients.
 */
export class GatewayServer extends EventEmitter {
  private app = Fastify({ logger: false });
  private config: ServerConfig;
  private agentController: AgentController;
  private approvals: ApprovalService;

  constructor(config: ServerConfig) {
    super();
    this.config = config;
    this.agentController = container.resolve(AgentController);
    this.approvals = container.resolve(ApprovalService);
  }

  async start(): Promise<void> {
    await this.app.register(websocket);
    await this.app.register(cors, {
      origin: ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:3002', 'http://127.0.0.1:3002'],
      methods: ['GET', 'POST', 'PUT', 'DELETE'],
    });

    // Centralized Error Handling
    this.app.setErrorHandler(errorHandler);

    // Register Migrated Routes
    await this.app.register(healthRoutes);
    await this.app.register(modelRoutes);
    await this.app.register(skillRoutes);
    await this.app.register(configRoutes);
    await this.app.register(agentRoutes);
    await this.app.register(systemRoutes);
    await this.app.register(taskRoutes);

    // WebSocket handling is now fully delegated to AgentController via agentRoutes
    // (Route /ws is registered in agentRoutes)

    // Listen on audit and token events to broadcast to connected clients
    auditLogger.on('log', (entry: any) => {
      this.agentController.broadcast({
        type: 'stream',
        sessionId: '00000000-0000-0000-0000-000000000000',
        traceId: entry.traceId,
        streamType: 'status',
        delta: `[${entry.actionType}] ${JSON.stringify(entry.payload).slice(0, 200)}`,
      });
    });

    tokenTracker.on('token_update', (update: any) => {
      this.agentController.broadcast({
        type: 'token_update',
        ...update,
      });
    });

    await this.app.listen({ port: this.config.port, host: this.config.host });
  }

  /** Send a frame to a specific session (delegated to agentController). */
  sendToSession(sessionId: string, frame: WebSocketFrame): void {
    // Note: sessionId here might refer to connection ID or agent sessionId.
    // AgentController currently doesn't map sessionIds to sockets, but it has connections map.
    // For now we broadcast or just delegate better later.
    this.agentController.broadcast(frame);
  }

  /** Resolve a pending approval (returns false if not found). */
  resolveApproval(id: string, approved: boolean): boolean {
    return this.approvals.resolve(id, approved);
  }

  async requestApproval(payload: {
    kind: string;
    description: string;
    meta?: Record<string, unknown>;
  }): Promise<boolean> {
    const id = crypto.randomUUID();
    const promise = this.approvals.requestManual(id, payload);

    this.agentController.broadcast({
      type: 'approval_request',
      id,
      kind: payload.kind,
      description: payload.description,
      meta: payload.meta || {},
      expiresAt: Date.now() + 60_000,
    } as any);

    return promise;
  }

  /** Broadcast a frame to all connected clients. */
  public broadcast(frame: WebSocketFrame): void {
    this.agentController.broadcast(frame);
  }

  /** Get connection count (delegated). */
  getConnectionCount(): number {
    return 0; // Or delegate to agentController if we add a getter
  }

  async stop(): Promise<void> {
    await this.app.close();
  }


}
