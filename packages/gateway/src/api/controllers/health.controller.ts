import { FastifyRequest, FastifyReply } from 'fastify';
import { singleton, inject } from 'tsyringe';
import { Logger } from '../../logger.js';
import { ConfigService } from '../../infrastructure/config/config-service.js';

@singleton()
export class HealthController {
  constructor(
    @inject(Logger) private logger: Logger,
    @inject(ConfigService) private config: ConfigService
  ) {}

  public async check(request: FastifyRequest, reply: FastifyReply) {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      agent: this.config.get('agentName'),
      version: process.env.npm_package_version || 'unknown'
    };
  }
}
