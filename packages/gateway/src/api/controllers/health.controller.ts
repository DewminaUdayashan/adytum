/**
 * @file packages/gateway/src/api/controllers/health.controller.ts
 * @description Handles API controller orchestration and response shaping.
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { singleton, inject } from 'tsyringe';
import { Logger } from '../../logger.js';
import { loadConfig } from '../../config.js';

/**
 * Encapsulates health controller behavior.
 */
@singleton()
export class HealthController {
  constructor(@inject(Logger) private logger: Logger) {}

  /**
   * Executes check.
   * @param request - Request.
   * @param reply - Reply.
   */
  public async check(request: FastifyRequest, reply: FastifyReply) {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      agent: loadConfig().agentName,
      version: process.env.npm_package_version || 'unknown',
    };
  }
}
