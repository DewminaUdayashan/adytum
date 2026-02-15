/**
 * @file packages/gateway/src/api/routes/system.routes.ts
 * @description Defines API route registration and endpoint wiring.
 */

import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { SystemController } from '../controllers/system.controller.js';

/**
 * Executes system routes.
 * @param app - App.
 */
export async function systemRoutes(app: FastifyInstance) {
  const controller = container.resolve(SystemController);

  app.get('/api/tokens', (req, reply) => controller.getTokens(req));
  app.get('/api/logs', (req, reply) => controller.getLogs(req));
  app.get('/api/link-preview', (req, reply) => controller.getLinkPreview(req, reply));
  app.get('/api/system/browse', (req, reply) => controller.browse(req));
  app.get('/api/system/files/*', (req, reply) => controller.serveFile(req, reply));
}
