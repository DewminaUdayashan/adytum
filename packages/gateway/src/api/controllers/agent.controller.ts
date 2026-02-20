/**
 * @file packages/gateway/src/api/controllers/agent.controller.ts
 * @description Handles API controller orchestration and response shaping.
 */

import { FastifyRequest, FastifyReply } from 'fastify';
// import { SocketStream } from '@fastify/websocket';
import { singleton, inject } from 'tsyringe';
import { Logger } from '../../logger.js';
import { AgentService } from '../../application/services/agent-service.js';
import { loadConfig } from '../../config.js';
import { AppError } from '../../domain/errors/app-error.js';
import { parseFrame, serializeFrame, type WebSocketFrame } from '@adytum/shared';
import { auditLogger } from '../../security/audit-logger.js';
import { randomUUID } from 'node:crypto';
import { MemoryRepository } from '../../domain/interfaces/memory-repository.interface.js';
import { ApprovalService } from '../../domain/logic/approval-service.js';
import { SoulEngine } from '../../domain/logic/soul-engine.js';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Encapsulates agent controller behavior.
 */
@singleton()
export class AgentController {
  private connections = new Map<string, any>();

  /**
   * Executes broadcast.
   * @param frame - Frame.
   */
  public broadcast(frame: WebSocketFrame): void {
    const data = serializeFrame(frame);
    for (const socket of this.connections.values()) {
      if (socket.readyState === 1) {
        // OPEN
        socket.send(data);
      }
    }
  }

  constructor(
    @inject(Logger) private logger: Logger,
    @inject(AgentService) private agentService: AgentService,
    @inject('MemoryRepository') private memoryRepo: MemoryRepository,
    @inject(ApprovalService) private approvals: ApprovalService,
    @inject(SoulEngine) private soulEngine: SoulEngine,
  ) {}

  /**
   * Handles web socket.
   * @param connection - Connection.
   * @param req - Req.
   */
  public handleWebSocket(connection: any /* SocketStream | WebSocket */, req: FastifyRequest) {
    // Handle both Fastify SocketStream and raw WebSocket
    const socket = connection.socket || connection;
    const id = randomUUID();

    try {
      if (!socket || !socket.on) {
        this.logger.error(
          `[WebSocket] Invalid connection object. Keys: ${Object.keys(connection || {})}`,
        );
        if (socket) socket.close();
        return;
      }

      this.connections.set(id, socket);
      this.logger.info(`Client connected: ${id}`);

      // Send initial history
      try {
        const existingLogs = auditLogger.getRecentLogs(50);
        for (const log of existingLogs) {
          if ((log as any).actionType === 'stream') {
            const payload = log.payload as any;
            if (socket.readyState === 1) {
              socket.send(
                serializeFrame({
                  type: 'stream',
                  traceId: payload.traceId || log.traceId,
                  sessionId: payload.sessionId || 'unknown',
                  delta: payload.delta || '',
                  streamType: payload.streamType || 'response',
                }),
              );
            }
          }
        }
      } catch (histErr) {
        this.logger.error(`Failed to send history to ${id}: ${histErr}`);
      }

      socket.on('message', async (data: any) => {
        try {
          const msg = data.toString();
          if (msg === 'ping') {
            socket.send('pong');
            return;
          }

          const frame = parseFrame(msg);

          // Handle approval responses from dashboard
          if (frame.type === 'approval_response' && frame.id) {
            this.approvals.resolve(frame.id, Boolean((frame as any).approved));
            return;
          }

          if (frame.type === 'message') {
            const { content, sessionId = 'default', workspaceId } = frame as any;
            const runtime = this.agentService.getRuntime();

            /**
             * Executes on stream.
             * @param event - Event.
             */
            const onStream = (event: any) => {
              if (event.sessionId === sessionId || event.sessionId === 'default') {
                if (socket.readyState === 1) {
                  socket.send(
                    serializeFrame({
                      type: 'stream',
                      traceId: event.traceId || randomUUID(),
                      sessionId: event.sessionId,
                      delta: event.delta || '',
                      streamType: event.streamType || 'response',
                      workspaceId,
                      metadata: event.metadata,
                    }),
                  );
                }
              }
            };

            runtime.on('stream', onStream);
            try {
              const result = await runtime.run(content, sessionId, {
                modelId: (frame as any).modelId,
                modelRole: (frame as any).modelRole,
                workspaceId: workspaceId,
              });

              if (socket.readyState === 1) {
                socket.send(
                  serializeFrame({
                    type: 'message',
                    sessionId: sessionId === 'default' ? randomUUID() : sessionId, // Ensure UUID if default
                    content: result.response,
                    modelRole: 'assistant',
                    workspaceId: workspaceId,
                  }),
                );
              }
            } finally {
              runtime.off('stream', onStream);
            }
          }
        } catch (err: any) {
          this.logger.error(`WebSocket message error: ${err.message}`);
          if (socket.readyState === 1) {
            socket.send(
              serializeFrame({
                type: 'error',
                code: 'INTERNAL_ERROR',
                message: err.message,
              }),
            );
          }
        }
      });

      socket.on('error', (err: any) => {
        this.logger.error(`WebSocket connection error (${id}): ${err.message}`);
      });

      socket.on('close', () => {
        this.connections.delete(id);
        this.logger.info(`Client disconnected: ${id}`);
      });
    } catch (err: any) {
      this.logger.error(`WebSocket setup failed for ${id}: ${err.message}`);
      socket.close();
      this.connections.delete(id);
    }
  }

  /**
   * Retrieves memories.
   * @param request - Request.
   * @param reply - Reply.
   */
  public async getMemories(request: FastifyRequest, reply: FastifyReply) {
    const { category, limit, offset } = request.query as {
      category?: string | string[];
      limit?: string;
      offset?: string;
    };
    const categories = Array.isArray(category)
      ? category
      : category
        ? category
            .split(',')
            .map((c) => c.trim())
            .filter(Boolean)
        : [];
    const count = Math.min(Number(limit) || 50, 200);
    const skip = Math.max(Number(offset) || 0, 0);

    const items = await this.memoryRepo.getMemoriesFiltered(categories, count, skip);
    return { items, total: items.length, hasMore: false };
  }

  /**
   * Executes update memory.
   * @param request - Request.
   */
  public async updateMemory(request: FastifyRequest) {
    const { id } = request.params as { id: string };
    const body = request.body as any;
    const updated = await this.memoryRepo.updateMemory(id, {
      content: body.content,
      category: body.category,
      tags: body.tags,
      metadata: body.metadata,
    });
    if (!updated) throw new AppError('Memory not found', 404);
    return { memory: updated };
  }

  /**
   * Executes delete memory.
   * @param request - Request.
   */
  public async deleteMemory(request: FastifyRequest) {
    const { id } = request.params as { id: string };
    const success = await this.memoryRepo.deleteMemory(id);
    if (!success) throw new AppError('Memory not found', 404);
    return { success: true };
  }

  /**
   * Retrieves approvals.
   * @param request - Request.
   */
  public async getApprovals(request: FastifyRequest) {
    return { approvals: this.approvals.getAllPending() };
  }

  /**
   * Executes resolve approval.
   * @param request - Request.
   */
  public async resolveApproval(request: FastifyRequest) {
    const { id } = request.params as { id: string };
    const body = request.body as { approved?: boolean };
    const ok = this.approvals.resolve(id, Boolean(body?.approved));
    if (!ok) throw new AppError('Approval not found or expired', 404);
    return { success: true, id, approved: Boolean(body?.approved) };
  }

  /**
   * Handles feedback.
   * @param request - Request.
   */
  public async handleFeedback(request: FastifyRequest) {
    const body = request.body as {
      traceId: string;
      rating: 'up' | 'down';
      reasonCode?: string;
      comment?: string;
    };
    if (!body.traceId || !body.rating) {
      throw new AppError('traceId and rating required', 400);
    }

    const feedback = {
      id: randomUUID(),
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
  }

  /**
   * Retrieves personality.
   * @param request - Request.
   */
  public async getPersonality(request: FastifyRequest) {
    return { content: this.soulEngine.getSoulPrompt() };
  }

  /**
   * Executes update personality.
   * @param request - Request.
   */
  public async updatePersonality(request: FastifyRequest) {
    const body = request.body as { content: string };
    if (!body.content) throw new AppError('content required', 400);

    this.soulEngine.updateSoul(body.content);
    this.agentService.getRuntime().refreshSystemPrompt();

    return { success: true, content: body.content };
  }

  /**
   * Retrieves heartbeat.
   * @param request - Request.
   */
  public async getHeartbeat(request: FastifyRequest) {
    const workspacePath = loadConfig().workspacePath;
    const heartbeatFile = join(workspacePath, 'HEARTBEAT.md');

    let content = '';
    if (existsSync(heartbeatFile)) {
      content = readFileSync(heartbeatFile, 'utf-8');
    }

    return { content };
  }

  /**
   * Executes update heartbeat.
   * @param request - Request.
   */
  public async updateHeartbeat(request: FastifyRequest) {
    const body = request.body as { content: string };
    if (body.content === undefined) throw new AppError('content required', 400);

    const workspacePath = loadConfig().workspacePath;
    const heartbeatFile = join(workspacePath, 'HEARTBEAT.md');

    writeFileSync(heartbeatFile, body.content, 'utf-8');

    return { success: true, content: body.content };
  }
}
