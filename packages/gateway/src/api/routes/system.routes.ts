import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { SystemController } from '../controllers/system.controller.js';

export async function systemRoutes(app: FastifyInstance) {
  const controller = container.resolve(SystemController);

  app.get('/api/tokens', (req, reply) => controller.getTokens(req));
  app.get('/api/logs', (req, reply) => controller.getLogs(req));
  app.get('/api/activity', (req, reply) => controller.getActivity(req));
  app.get('/api/link-preview', (req, reply) => controller.getLinkPreview(req, reply));
}
