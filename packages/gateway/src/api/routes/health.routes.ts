import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { HealthController } from '../controllers/health.controller.js';

export async function healthRoutes(app: FastifyInstance) {
  const controller = container.resolve(HealthController);

  app.get('/api/health', (req, reply) => controller.check(req, reply));
}
