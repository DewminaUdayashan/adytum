/**
 * @file packages/gateway/src/api/routes/health.routes.ts
 * @description Defines API route registration and endpoint wiring.
 */

import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { HealthController } from '../controllers/health.controller.js';

/**
 * Executes health routes.
 * @param app - App.
 */
export async function healthRoutes(app: FastifyInstance) {
  const controller = container.resolve(HealthController);

  app.get('/api/health', (req, reply) => controller.check(req, reply));
}
