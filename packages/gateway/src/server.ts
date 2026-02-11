import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import cors from '@fastify/cors';
import { parseFrame, serializeFrame, type WebSocketFrame } from '@adytum/shared';
import { auditLogger } from './security/audit-logger.js';
import { tokenTracker } from './agent/token-tracker.js';
import { EventEmitter } from 'node:events';
import { saveConfig } from './config.js';
import type { WebSocket } from 'ws';
import type { PermissionManager } from './security/permission-manager.js';
import type { HeartbeatManager } from './agent/heartbeat-manager.js';
import type { CronManager } from './agent/cron-manager.js';

export interface ServerConfig {
  port: number;
  host: string;
  permissionManager?: PermissionManager;
  workspacePath?: string;
  heartbeatManager?: HeartbeatManager;
  cronManager?: CronManager;
  /** Callback to reschedule dreamer/monologue intervals */
  onScheduleUpdate?: (type: 'dreamer' | 'monologue', intervalMinutes: number) => void;
}

/**
 * Gateway Server — Fastify + WebSocket.
 * Manages client connections, routes messages to the agent runtime,
 * and streams events back to connected clients.
 */
export class GatewayServer extends EventEmitter {
  private app = Fastify({ logger: false });
  private connections = new Map<string, WebSocket>();
  private config: ServerConfig;

  constructor(config: ServerConfig) {
    super();
    this.config = config;
  }

  async start(): Promise<void> {
    await this.app.register(websocket);
    await this.app.register(cors, {
      origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
      methods: ['GET', 'POST', 'PUT', 'DELETE'],
    });

    // ─── REST Routes ────────────────────────────────────────
    this.app.get('/api/health', async () => ({
      status: 'alive',
      version: '0.1.0',
      connections: this.connections.size,
      uptime: process.uptime(),
      tokens: tokenTracker.getTotalUsage(),
    }));

    this.app.get('/api/tokens', async () => ({
      total: tokenTracker.getTotalUsage(),
      daily: tokenTracker.getDailyUsage(),
      recent: tokenTracker.getRecentRecords(20),
    }));

    this.app.get('/api/logs', async (request) => {
      const { limit, type } = request.query as { limit?: string; type?: string };
      const count = Math.min(Number(limit) || 50, 200);
      let logs = auditLogger.getRecentLogs(count);
      if (type) {
        logs = logs.filter((l) => l.actionType === type);
      }
      return { logs };
    });

    // ─── Activity Feed (traces with their logs) ─────────────
    this.app.get('/api/activity', async (request) => {
      const { limit, offset } = request.query as { limit?: string; offset?: string };
      const count = Math.min(Number(limit) || 30, 100);
      const skip = Number(offset) || 0;
      const logs = auditLogger.getRecentLogs(200);
      const sliced = logs.slice(skip, skip + count);
      return {
        activities: sliced,
        total: logs.length,
        hasMore: skip + count < logs.length,
      };
    });

    // ─── Feedback Submission ────────────────────────────────
    this.app.post('/api/feedback', async (request, reply) => {
      const body = request.body as {
        traceId: string;
        rating: 'up' | 'down';
        reasonCode?: string;
        comment?: string;
      };
      if (!body.traceId || !body.rating) {
        return reply.status(400).send({ error: 'traceId and rating required' });
      }
      const feedback = {
        id: crypto.randomUUID(),
        traceId: body.traceId,
        rating: body.rating === 'up' ? 1 : -1,
        reasonCode: body.reasonCode,
        comment: body.comment,
        createdAt: Date.now(),
      };
      auditLogger.log({
        traceId: body.traceId,
        actionType: 'message_received',
        payload: { feedback },
        status: 'success',
      });
      return { success: true, feedback };
    });

    // ─── Permissions Management ─────────────────────────────
    this.app.get('/api/permissions', async () => {
      if (!this.config.permissionManager) return { permissions: [] };
      return { permissions: this.config.permissionManager.getPermissions() };
    });

    this.app.post('/api/permissions/grant', async (request, reply) => {
      if (!this.config.permissionManager) {
        return reply.status(503).send({ error: 'Permission manager not available' });
      }
      const body = request.body as { path: string; mode: string; durationMs?: number };
      if (!body.path || !body.mode) {
        return reply.status(400).send({ error: 'path and mode required' });
      }
      this.config.permissionManager.grantAccess(body.path, body.mode as any, body.durationMs);
      return { success: true };
    });

    this.app.post('/api/permissions/revoke', async (request, reply) => {
      if (!this.config.permissionManager) {
        return reply.status(503).send({ error: 'Permission manager not available' });
      }
      const body = request.body as { path: string };
      if (!body.path) {
        return reply.status(400).send({ error: 'path required' });
      }
      this.config.permissionManager.revokeAccess(body.path);
      return { success: true };
    });

    // ─── SOUL.md / Personality ───────────────────────────────
    this.app.get('/api/personality', async () => {
      if (!this.config.workspacePath) return { content: '' };
      const { readFileSync, existsSync } = await import('node:fs');
      const { join } = await import('node:path');
      const soulPath = join(this.config.workspacePath, 'SOUL.md');
      if (!existsSync(soulPath)) return { content: '' };
      return { content: readFileSync(soulPath, 'utf-8') };
    });

    this.app.put('/api/personality', async (request, reply) => {
      if (!this.config.workspacePath) {
        return reply.status(503).send({ error: 'Workspace path not configured' });
      }
      const { content } = request.body as { content: string };
      if (typeof content !== 'string') {
        return reply.status(400).send({ error: 'content string required' });
      }
      const { writeFileSync } = await import('node:fs');
      const { join } = await import('node:path');
      writeFileSync(join(this.config.workspacePath, 'SOUL.md'), content, 'utf-8');
      return { success: true };
    });

    // ─── HEARTBEAT.md / Goals ────────────────────────────────
    this.app.get('/api/heartbeat', async () => {
      if (!this.config.workspacePath) return { content: '' };
      const { readFileSync, existsSync } = await import('node:fs');
      const { join } = await import('node:path');
      const hbPath = join(this.config.workspacePath, 'HEARTBEAT.md');
      if (!existsSync(hbPath)) return { content: '' };
      return { content: readFileSync(hbPath, 'utf-8') };
    });

    this.app.put('/api/heartbeat', async (request, reply) => {
      if (!this.config.workspacePath) {
        return reply.status(503).send({ error: 'Workspace path not configured' });
      }
      const { content } = request.body as { content: string };
      if (typeof content !== 'string') {
        return reply.status(400).send({ error: 'content string required' });
      }
      const { writeFileSync } = await import('node:fs');
      const { join } = await import('node:path');
      writeFileSync(join(this.config.workspacePath, 'HEARTBEAT.md'), content, 'utf-8');
      return { success: true };
    });

    this.app.get('/api/heartbeat/config', async (request, reply) => {
       if (!this.config.heartbeatManager) {
         // Fallback if not injected, although it should be
         return reply.status(503).send({ error: 'Heartbeat manager not available' });
       }
       // We need to read the current config. Ideally we should have access to the full config object
       // But we can get it from the manager if we exposed it, or re-read it.
       // Simpler: The manager likely knows its interval? Actually I didn't expose getInterval.
       // Let's just read it from the config file or assume standard.
       // Better: read Adytum config again or rely on what was passed.
       // Since I don't have easy access to the global `config` object here (it's in index.ts),
       // I will import `loadConfig` to get the cached one.
       const { loadConfig } = await import('./config.js');
       const cfg = loadConfig();
       return { interval: cfg.heartbeatIntervalMinutes };
    });

    this.app.put('/api/heartbeat/config', async (request, reply) => {
       if (!this.config.heartbeatManager) {
         return reply.status(503).send({ error: 'Heartbeat manager not available' });
       }
       const body = request.body as { interval: number };
       const interval = Number(body.interval);
       if (!interval || interval < 1) {
         return reply.status(400).send({ error: 'Invalid interval' });
       }

       // 1. Update runtime manager
       this.config.heartbeatManager.schedule(interval);

       // 2. Persist to config
       saveConfig({ heartbeatIntervalMinutes: interval });

       return { success: true, interval };
    });

    // ─── Schedule Settings (Dreamer / Monologue / Heartbeat) ─
    this.app.get('/api/schedules', async () => {
       const { loadConfig } = await import('./config.js');
       const cfg = loadConfig();
       return {
         heartbeat: cfg.heartbeatIntervalMinutes,
         dreamer: cfg.dreamerIntervalMinutes,
         monologue: cfg.monologueIntervalMinutes,
       };
    });

    this.app.put('/api/schedules', async (request, reply) => {
       const body = request.body as {
         heartbeat?: number;
         dreamer?: number;
         monologue?: number;
       };

       const updates: Record<string, number> = {};
       const results: Record<string, number> = {};

       if (body.heartbeat && body.heartbeat >= 1) {
         const interval = Math.floor(body.heartbeat);
         if (this.config.heartbeatManager) {
           this.config.heartbeatManager.schedule(interval);
         }
         updates.heartbeatIntervalMinutes = interval;
         results.heartbeat = interval;
       }

       if (body.dreamer && body.dreamer >= 1) {
         const interval = Math.floor(body.dreamer);
         this.config.onScheduleUpdate?.('dreamer', interval);
         updates.dreamerIntervalMinutes = interval;
         results.dreamer = interval;
       }

       if (body.monologue && body.monologue >= 1) {
         const interval = Math.floor(body.monologue);
         this.config.onScheduleUpdate?.('monologue', interval);
         updates.monologueIntervalMinutes = interval;
         results.monologue = interval;
       }

       if (Object.keys(updates).length === 0) {
         return reply.status(400).send({ error: 'Provide at least one of: heartbeat, dreamer, monologue (minutes, >= 1)' });
       }

       // Persist to config file
       saveConfig(updates);

       return { success: true, ...results };
    });

    // ─── Cron Jobs API ──────────────────────────────────────
    this.app.get('/api/cron', async () => {
       if (!this.config.cronManager) return { jobs: [] };
       return { jobs: this.config.cronManager.getAllJobs() };
    });

    this.app.post('/api/cron', async (request, reply) => {
       if (!this.config.cronManager) return reply.status(503).send({ error: 'Cron manager not available' });
       const { name, schedule, task } = request.body as any;
       if (!name || !schedule || !task) return reply.status(400).send({ error: 'Missing fields' });
       
       try {
           const job = this.config.cronManager.addJob(name, schedule, task);
           return { job };
       } catch (err: any) {
           return reply.status(400).send({ error: err.message });
       }
    });

    this.app.put('/api/cron/:id', async (request, reply) => {
        if (!this.config.cronManager) return reply.status(503).send({ error: 'Cron manager not available' });
        const { id } = request.params as { id: string };
        const updates = request.body as any;
        
        try {
            const job = this.config.cronManager.updateJob(id, updates);
            return { job };
        } catch (err: any) {
            return reply.status(404).send({ error: err.message });
        }
    });

    this.app.delete('/api/cron/:id', async (request, reply) => {
        if (!this.config.cronManager) return reply.status(503).send({ error: 'Cron manager not available' });
        const { id } = request.params as { id: string };
        this.config.cronManager.removeJob(id);
        return { success: true };
    });

    // ─── WebSocket Route ────────────────────────────────────
    this.app.get('/ws', { websocket: true }, (socket, req) => {
      let sessionId: string | null = null;

      socket.on('message', (raw: Buffer) => {
        try {
          const frame = parseFrame(raw.toString());

          if (frame.type === 'connect') {
            sessionId = frame.sessionId || crypto.randomUUID();
            if (sessionId) {
              this.connections.set(sessionId, socket);

              this.sendFrame(socket, {
                type: 'connect',
                channel: frame.channel,
                sessionId,
              });

              this.emit('client_connected', { sessionId, channel: frame.channel });
            }
            return;
          }

          if (!sessionId) {
            this.sendFrame(socket, {
              type: 'error',
              code: 'NO_SESSION',
              message: 'Must send connect frame first',
            });
            socket.close();
            return;
          }

          // Route frame to handler
          this.emit('frame', { sessionId, frame });
        } catch (error: any) {
          this.sendFrame(socket, {
            type: 'error',
            code: 'INVALID_FRAME',
            message: `Malformed frame: ${error.message}`,
          });
          socket.close();
        }
      });

      socket.on('close', () => {
        if (sessionId) {
          this.connections.delete(sessionId);
          this.emit('client_disconnected', { sessionId });
        }
      });
    });

    // Listen on audit and token events to broadcast to connected clients
    auditLogger.on('log', (entry: any) => {
      this.broadcastToAll({
        type: 'stream',
        sessionId: '00000000-0000-0000-0000-000000000000',
        traceId: entry.traceId,
        streamType: 'status',
        delta: `[${entry.actionType}] ${JSON.stringify(entry.payload).slice(0, 200)}`,
      });
    });

    tokenTracker.on('token_update', (update: any) => {
      this.broadcastToAll({
        type: 'token_update',
        ...update,
      });
    });

    await this.app.listen({ port: this.config.port, host: this.config.host });
  }

  /** Send a frame to a specific session. */
  sendToSession(sessionId: string, frame: WebSocketFrame): void {
    const socket = this.connections.get(sessionId);
    if (socket?.readyState === 1) {
      this.sendFrame(socket, frame);
    }
  }

  /** Broadcast a frame to all connected clients. */
  broadcastToAll(frame: WebSocketFrame): void {
    const data = serializeFrame(frame);
    for (const socket of this.connections.values()) {
      if (socket.readyState === 1) {
        socket.send(data);
      }
    }
  }

  /** Get connection count. */
  getConnectionCount(): number {
    return this.connections.size;
  }

  async stop(): Promise<void> {
    for (const socket of this.connections.values()) {
      socket.close();
    }
    this.connections.clear();
    await this.app.close();
  }

  private sendFrame(socket: WebSocket, frame: WebSocketFrame): void {
    socket.send(serializeFrame(frame));
  }
}
