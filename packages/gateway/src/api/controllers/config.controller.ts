import { FastifyRequest, FastifyReply } from 'fastify';
import { singleton, inject } from 'tsyringe';
import { Logger } from '../../logger.js';
import { ConfigService } from '../../infrastructure/config/config-service.js';
import { AppError } from '../../domain/errors/app-error.js';

@singleton()
export class ConfigController {
  constructor(
    @inject(Logger) private logger: Logger,
    @inject(ConfigService) private config: ConfigService
  ) {}

  public async getRoles(request: FastifyRequest, reply: FastifyReply) {
    const config = this.config.getFullConfig();
    
    // Map existing models to their roles to see what's active
    const active: Record<string, string> = {};
    const chains: Record<string, string[]> = { ...config.modelChains };

    if (config.models) {
      for (const m of config.models) {
        if (m.role) {
          const modelId = `${m.provider}/${m.model}`;
          active[m.role as string] = modelId;
          
          // Seed chains from models if chains are empty
          if (!chains[m.role] || chains[m.role].length === 0) {
            chains[m.role] = [modelId];
          }
        }
      }
    }

    return {
      roles: ['thinking', 'fast', 'local'],
      active,
      chains
    };
  }

  public async getChains(request: FastifyRequest, reply: FastifyReply) {
    const config = this.config.getFullConfig();
    return { modelChains: config.modelChains || { thinking: [], fast: [], local: [] } };
  }

  public async updateChains(request: FastifyRequest, reply: FastifyReply) {
    const body = request.body as { modelChains: Record<string, string[]> };
    if (!body.modelChains) {
      throw new AppError('modelChains required', 400);
    }
    this.config.set({ modelChains: body.modelChains as any });
    return { success: true, modelChains: body.modelChains };
  }

  public async getRouting(request: FastifyRequest, reply: FastifyReply) {
    const config = this.config.getFullConfig();
    return {
      routing: config.routing || {
        maxRetries: 5,
        fallbackOnRateLimit: true,
        fallbackOnError: false,
      },
    };
  }

  public async updateRouting(request: FastifyRequest, reply: FastifyReply) {
    const body = request.body as {
      routing?: { maxRetries?: number; fallbackOnRateLimit?: boolean; fallbackOnError?: boolean };
    };
    if (!body.routing) throw new AppError('routing required', 400);

    const routing = {
      maxRetries: Math.min(Math.max(Number(body.routing.maxRetries ?? 5), 1), 10),
      fallbackOnRateLimit: body.routing.fallbackOnRateLimit ?? true,
      fallbackOnError: body.routing.fallbackOnError ?? false,
    };
    this.config.set({ routing: routing as any });
    return { success: true, routing };
  }

  public async getOverrides(request: FastifyRequest, reply: FastifyReply) {
    const config = this.config.getFullConfig();
    return { taskOverrides: config.taskOverrides || {} };
  }

  public async updateOverrides(request: FastifyRequest, reply: FastifyReply) {
    const body = request.body as { taskOverrides: Record<string, string> };
    if (!body.taskOverrides) throw new AppError('taskOverrides required', 400);
    this.config.set({ taskOverrides: body.taskOverrides } as any);
    return { success: true, taskOverrides: body.taskOverrides };
  }

  public async getSoul(request: FastifyRequest, reply: FastifyReply) {
    const config = this.config.getFullConfig();
    return { soul: config.soul || { autoUpdate: true } };
  }

  public async updateSoul(request: FastifyRequest, reply: FastifyReply) {
    const body = request.body as { soul: { autoUpdate: boolean } };
    if (!body.soul) throw new AppError('soul config required', 400);
    this.config.set({ soul: body.soul as any });
    return { success: true, soul: body.soul };
  }

  public async getSchedules(request: FastifyRequest, reply: FastifyReply) {
    const config = this.config.getFullConfig();
    return {
      heartbeat: config.heartbeatIntervalMinutes || 30,
      dreamer: config.dreamerIntervalMinutes || 30,
      monologue: config.monologueIntervalMinutes || 15,
    };
  }

  public async updateSchedules(request: FastifyRequest, reply: FastifyReply) {
    const body = request.body as { heartbeat?: number; dreamer?: number; monologue?: number };
    const updates: any = {};
    if (body.heartbeat !== undefined) updates.heartbeatIntervalMinutes = body.heartbeat;
    if (body.dreamer !== undefined) updates.dreamerIntervalMinutes = body.dreamer;
    if (body.monologue !== undefined) updates.monologueIntervalMinutes = body.monologue;

    this.config.set(updates);
    return { success: true, ...body };
  }
}
