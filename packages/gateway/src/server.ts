/**
 * @file packages/gateway/src/server.ts
 * @description Defines module behavior for the Adytum workspace.
 */

import Fastify from 'fastify';
// import websocket from '@fastify/websocket';
import cors from '@fastify/cors';
import { EventEmitter } from 'node:events';
import type { WebSocket } from 'ws';
import { type AdytumConfig, serializeFrame, type WebSocketFrame } from '@adytum/shared';
import crypto from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { logger } from './logger.js';

import { errorHandler } from './api/middleware/error.middleware.js';
import { modelRoutes } from './api/routes/model.routes.js';
import { skillRoutes } from './api/routes/skill.routes.js';
import { configRoutes } from './api/routes/config.routes.js';
import { healthRoutes } from './api/routes/health.routes.js';
import { agentRoutes } from './api/routes/agent.routes.js';
import { systemRoutes } from './api/routes/system.routes.js';
import { taskRoutes } from './api/routes/task.routes.js';
import { knowledgeRoutes } from './api/routes/knowledge.routes.js';
import { agentsRoutes } from './api/routes/agents.routes.js';

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
import type { ModelRouter } from './infrastructure/llm/model-router.js';
import type { SocketIOService } from './infrastructure/events/socket-io-service.js';

import { AgentsController } from './api/controllers/agents.controller.js';

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
  modelRouter?: ModelRouter;
  secretsStore?: SecretsStore;
  onScheduleUpdate?: (type: 'dreamer' | 'monologue', intervalMinutes: number) => void;
  onSkillsReload?: () => Promise<void>;
  onChainsUpdate?: (chains: Record<string, string[]>) => void;
  onRoutingUpdate?: (routing: AdytumConfig['routing']) => void;
  socketIOService?: SocketIOService;
  agentsController?: AgentsController;
}

/**
 * Gateway Server — Fastify + WebSocket.
 * Manages client connections, routes messages to the agent runtime,
 * and streams events back to connected clients.
 */
import { SensorManager } from './infrastructure/sensors/sensor-manager.js';
import { SystemHealthSensor } from './infrastructure/sensors/system-health-sensor.js';
import { KnowledgeWatcher } from './domain/knowledge/knowledge-watcher.js';

export class GatewayServer extends EventEmitter {
  private app = Fastify({ logger: false });
  private config: ServerConfig;
  private agentController: AgentController;
  private agentsController?: AgentsController; // Add this
  private approvals: ApprovalService;
  private sensorManager: SensorManager;

  constructor(config: ServerConfig) {
    super();
    this.config = config;
    this.agentController = container.resolve(AgentController);
    this.agentsController = config.agentsController; // Inject
    this.approvals = container.resolve(ApprovalService);
    this.sensorManager = container.resolve(SensorManager);
  }

  /**
   * Executes start.
   */
  async start(): Promise<void> {
    // Initialize Socket.IO with the underlying HTTP server EARLY to get priority for upgrade events
    if (this.config.socketIOService) {
      this.config.socketIOService.initialize(this.app.server);

      // Bridge incoming Socket.IO messages to the internal frame system
      this.config.socketIOService.on('message', (data: any) => {
        if (!data) return;

        // Handle responses first (they might not always have a sessionId)
        if (data.type === 'input_response' && data.id && data.response) {
          logger.info(`Received input response for ${data.id}`);
          const resolved = this.resolveInput(data.id, data.response);
          logger.info(`Input ${data.id} resolved: ${resolved}`);
        } else if (data.type === 'approval_response' && data.id) {
          logger.info(`Received approval response for ${data.id}: ${data.approved}`);
          const resolved = this.resolveApproval(data.id, Boolean(data.approved));
          logger.info(`Approval ${data.id} resolved: ${resolved}`);
        } else if (data.sessionId) {
          // Standard frames require a sessionId for routing
          this.emit('frame', {
            sessionId: data.sessionId,
            frame: data,
          });
        }
      });
    }

    await this.app.register(cors, {
      origin: [
        'http://localhost:3000',
        'http://127.0.0.1:3000',
        'http://localhost:7432',
        'http://127.0.0.1:7432',
      ],
      methods: ['GET', 'POST', 'PUT', 'DELETE'],
    });

    // Register a placeholder route for /socket.io to prevent Fastify 404s during polling
    this.app.get('/socket.io/*', async (req, reply) => {
      return reply.status(200).send();
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
    await this.app.register(knowledgeRoutes);
    await this.app.register(agentsRoutes); // This route file needs to use agentsController

    this.app.get('/api/models/runtime-status', async () => {
      return {
        statuses: this.config.modelRouter?.getModelRuntimeStatuses() || {},
      };
    });

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

    // Initialize Sensors
    // We manually register known sensors here to ensure they are picked up
    // In the future, this could be auto-di-scanned
    this.sensorManager.register(container.resolve(SystemHealthSensor));

    // KnowledgeWatcher is a special case as it needs workspacePath which is injected via factory or config usually
    // But since it is a singleton currently getting injected with GraphIndexer, we can try resolving it.
    // However, KnowledgeWatcher constructor takes (GraphIndexer, workspacePath).
    // The DI container might fail if workspacePath isn't registered as a token.
    // For now, let's assume KnowledgeWatcher is manually instantiated or we register it if we can find it.
    // Actually, KnowledgeWatcher is started in index.ts usually?
    // Let's check index.ts. If it's already running there, we might need to unify.
    // For now let's just register SystemHealthSensor and start the manager.
    await this.sensorManager.startAll();

    logger.info(`Starting Gateway Server on ${this.config.host}:${this.config.port}...`);

    await this.app.ready();

    const address = await this.app.listen({ port: this.config.port, host: this.config.host });
    logger.info(`Gateway Server listening at ${address}`);
  }

  /** Send a frame to a specific session (delegated to agentController). */
  sendToSession(sessionId: string, frame: WebSocketFrame): void {
    if (this.config.socketIOService) {
      this.config.socketIOService.broadcast('message', frame); // For now broadcast, or improve SocketIOService to target sessions
    }
  }

  /** Resolve a pending approval (returns false if not found). */
  resolveApproval(id: string, approved: boolean): boolean {
    return this.approvals.resolve(id, approved);
  }

  /**
   * Executes request approval.
   * @param payload - Payload.
   * @returns Whether the operation succeeded.
   */
  async requestApproval(payload: {
    kind: string;
    description: string;
    meta?: Record<string, unknown>;
    sessionId?: string;
    workspaceId?: string;
  }): Promise<boolean> {
    const id = crypto.randomUUID();
    const promise = this.approvals.requestManual(id, payload);

    this.broadcast({
      type: 'approval_request',
      id,
      kind: payload.kind,
      description: payload.description,
      meta: payload.meta || {},
      sessionId: payload.sessionId,
      workspaceId: payload.workspaceId,
      expiresAt: Date.now() + 60_000,
    } as any);

    return promise;
  }

  /** Broadcast a frame to all connected clients. */
  public broadcast(frame: WebSocketFrame): void {
    if (this.config.socketIOService) {
      this.config.socketIOService.broadcast('message', frame);
    }
  }

  /** Get connection count (delegated). */
  getConnectionCount(): number {
    return 0; // Or delegate to agentController if we add a getter
  }

  /**
   * Executes stop.
   */
  async stop(): Promise<void> {
    await this.sensorManager.stopAll();
    if (this.config.socketIOService) {
      await this.config.socketIOService.stop();
    }
    await this.app.close();
  }

  // ─── Input Requests ──────────────────────────────────────

  /**
   * Resolve a pending input request.
   */
  resolveInput(id: string, value: string): boolean {
    return this.approvals.resolveInput(id, value);
  }

  /**
   * Request text input from the user.
   */
  async requestInput(
    description: string,
    metadata?: { sessionId?: string; workspaceId?: string },
  ): Promise<string> {
    const id = crypto.randomUUID();
    const promise = this.approvals.requestInput(id, description);

    // Broadcast input request to frontend
    this.broadcast({
      type: 'input_request',
      id,
      description,
      sessionId: metadata?.sessionId,
      workspaceId: metadata?.workspaceId,
      expiresAt: Date.now() + 300_000,
    } as any);

    // Emit local event for CLI handling
    this.emit('input_request', {
      id,
      description,
      sessionId: metadata?.sessionId,
      workspaceId: metadata?.workspaceId,
    });

    return promise;
  }
}
