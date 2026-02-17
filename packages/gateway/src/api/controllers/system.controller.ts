/**
 * @file packages/gateway/src/api/controllers/system.controller.ts
 * @description Handles API controller orchestration and response shaping.
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { singleton, inject } from 'tsyringe';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Logger } from '../../logger.js';
import { auditLogger } from '../../security/audit-logger.js';
import { AppError } from '../../domain/errors/app-error.js';
import { MemoryDB } from '../../infrastructure/repositories/memory-db.js';
import { ConfigService } from '../../infrastructure/config/config-service.js';
import { createReadStream, existsSync } from 'node:fs';

/**
 * Encapsulates system controller behavior.
 */
@singleton()
export class SystemController {
  constructor(
    @inject(Logger) private logger: Logger,
    @inject('MemoryDB') private memoryDb: MemoryDB,
    @inject(ConfigService) private configService: ConfigService,
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

    return { url: target.toString(), title: target.hostname };
  }

  /**
   * Serves a file from the workspace.
   */
  public async serveFile(request: FastifyRequest, reply: FastifyReply) {
    const rawPath = (request.params as any)['*'];
    if (!rawPath) {
      throw new AppError('File path is required', 400);
    }

    const config = this.configService.getFullConfig();
    const workspacePath = path.resolve(config.workspacePath);
    const targetPath = path.normalize(path.join(workspacePath, rawPath));

    // Security check: ensure the path is within the workspace
    if (!targetPath.startsWith(workspacePath)) {
      this.logger.warn(`Security alert: Attempted unauthorized file access: ${targetPath}`);
      throw new AppError('Access denied', 403);
    }

    if (!existsSync(targetPath)) {
      throw new AppError('File not found', 404);
    }

    const stats = await fs.stat(targetPath);
    if (!stats.isFile()) {
      throw new AppError('Requested path is not a file', 400);
    }

    // Determine content type (basic)
    const ext = path.extname(targetPath).toLowerCase();
    const contentTypes: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.pdf': 'application/pdf',
      '.txt': 'text/plain',
      '.md': 'text/markdown',
    };

    const contentType = contentTypes[ext] || 'application/octet-stream';
    reply.header('Content-Type', contentType);
    reply.header('Content-Length', stats.size);
    
    // Cache for 1 hour for images
    if (contentType.startsWith('image/')) {
        reply.header('Cache-Control', 'public, max-age=3600');
    }

    return reply.send(createReadStream(targetPath));
  }

  /**
   * Browses local directories.
   * @param request - Request.
   */
  public async browse(request: FastifyRequest) {
    const { p } = request.query as { p?: string };
    const targetPath = p || os.homedir();

    try {
      const stats = await fs.stat(targetPath);
      if (!stats.isDirectory()) {
        throw new AppError('Path is not a directory', 400);
      }

      const entries = await fs.readdir(targetPath, { withFileTypes: true });
      const items = entries
        .map((entry) => ({
          name: entry.name,
          path: path.join(targetPath, entry.name),
          type: entry.isDirectory() ? ('directory' as const) : ('file' as const),
        }))
        .filter((item) => !item.name.startsWith('.'))
        .sort((a, b) => {
          if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
          return a.name.localeCompare(b.name);
        });

      return {
        currentPath: targetPath,
        parentPath: path.dirname(targetPath),
        items,
      };
    } catch (err: any) {
      this.logger.error(`Browse failed for ${targetPath}: ${err.message}`);
      throw new AppError(`Failed to browse path: ${err.message}`, 500);
    }
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
