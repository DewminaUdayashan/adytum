import { FastifyRequest, FastifyReply } from 'fastify';
import { singleton, inject } from 'tsyringe';
import { Logger } from '../../logger.js';
import { tokenTracker } from '../../domain/logic/token-tracker.js';
import { auditLogger } from '../../security/audit-logger.js';
import { AppError } from '../../domain/errors/app-error.js';

@singleton()
export class SystemController {
  constructor(
    @inject(Logger) private logger: Logger
  ) {}

  public async getTokens(request: FastifyRequest) {
    const { from, to, limit } = request.query as { from?: string; to?: string; limit?: string };
    const fromMs = from ? Number(from) : undefined;
    const toMs = to ? Number(to) : undefined;
    const recentLimit = Math.min(Number(limit) || 20, 200);

    return {
      total: tokenTracker.getTotalUsage(fromMs, toMs),
      daily: tokenTracker.getDailyUsage(fromMs, toMs),
      recent: tokenTracker.getRecentRecords(recentLimit, fromMs, toMs),
    };
  }

  public async getLogs(request: FastifyRequest) {
    const { limit, type } = request.query as { limit?: string; type?: string };
    const count = Math.min(Number(limit) || 50, 200);
    let logs = auditLogger.getRecentLogs(count);
    if (type) {
      logs = logs.filter((l) => l.actionType === type);
    }
    return { logs };
  }

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
}
