/**
 * @file packages/gateway/src/api/controllers/system.controller.ts
 * @description Handles API controller orchestration and response shaping.
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { singleton, inject } from 'tsyringe';
import { Logger } from '../../logger.js';
import { auditLogger } from '../../security/audit-logger.js';
import { AppError } from '../../domain/errors/app-error.js';
import { MemoryDB } from '../../infrastructure/repositories/memory-db.js';

/**
 * Encapsulates system controller behavior.
 */
@singleton()
export class SystemController {
  constructor(
    @inject(Logger) private logger: Logger,
    @inject('MemoryDB') private memoryDb: MemoryDB,
  ) {}

  /**
   * Retrieves tokens.
   * @param request - Request.
   */
  public async getTokens(request: FastifyRequest) {
    const { from, to, limit, provider, modelId } = request.query as {
      from?: string;
      to?: string;
      limit?: string;
      provider?: string;
      modelId?: string;
    };
    const fromMs = this.parseMs(from);
    const toMs = this.parseMs(to);
    const recentLimit = Math.min(Number(limit) || 20, 200);
    const providers = this.parseList(provider);
    const modelIds = this.parseList(modelId);
    const filter = { from: fromMs, to: toMs, providers, modelIds };

    const total = this.memoryDb.getTokenUsageTotals(filter);
    const byProvider = this.memoryDb.getTokenUsageByProvider(filter);
    const byModel = this.memoryDb.getTokenUsageByModel(filter);
    const daily = this.memoryDb.getTokenUsageDaily(filter).map((row) => ({
      date: row.date,
      provider: row.provider,
      model: row.modelId,
      modelName: row.model,
      modelId: row.modelId,
      role: row.role,
      tokens: row.tokens,
      cost: row.cost,
      calls: row.calls,
    }));
    const recent = this.memoryDb.getRecentTokenUsage(recentLimit, filter).map((row) => ({
      model: row.modelId,
      modelName: row.model,
      modelId: row.modelId,
      provider: row.provider,
      role: row.role,
      promptTokens: row.promptTokens,
      completionTokens: row.completionTokens,
      totalTokens: row.totalTokens,
      estimatedCost: row.cost,
      timestamp: row.createdAt,
      sessionId: row.sessionId,
    }));

    return {
      total,
      byProvider,
      byModel,
      daily,
      recent,
    };
  }

  /**
   * Retrieves logs.
   * @param request - Request.
   */
  public async getLogs(request: FastifyRequest) {
    const { limit, type } = request.query as { limit?: string; type?: string };
    const count = Math.min(Number(limit) || 50, 200);
    let logs = auditLogger.getRecentLogs(count);
    if (type) {
      logs = logs.filter((l) => l.actionType === type);
    }
    return { logs };
  }

  /**
   * Retrieves activity.
   * @param request - Request.
   */
  public async getActivity(request: FastifyRequest) {
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
  }

  /**
   * Retrieves link preview.
   * @param request - Request.
   * @param reply - Reply.
   */
  public async getLinkPreview(request: FastifyRequest, reply: FastifyReply) {
    const { url } = request.query as { url?: string };
    if (!url || typeof url !== 'string') {
      throw new AppError('url query parameter is required', 400);
    }

    let target: URL;
    try {
      target = new URL(url);
    } catch {
      throw new AppError('Invalid URL', 400);
    }

    // Logic from server.ts (simplified for now or call helper)
    // For now I'll just keep it as a placeholder or copy the core logic
    return { url: target.toString(), title: target.hostname };
  }

  /**
   * Parses ms.
   * @param value - Value.
   * @returns The parse ms result.
   */
  private parseMs(value?: string): number | undefined {
    if (!value) return undefined;
    const num = Number(value);
    return Number.isFinite(num) ? num : undefined;
  }

  /**
   * Parses list.
   * @param value - Value.
   * @returns The resulting collection of values.
   */
  private parseList(value?: string): string[] {
    if (!value) return [];
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
}
