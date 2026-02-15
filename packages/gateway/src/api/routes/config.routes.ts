/**
 * @file packages/gateway/src/api/routes/config.routes.ts
 * @description Defines API route registration and endpoint wiring.
 */

import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { ConfigController } from '../controllers/config.controller.js';

/**
 * Executes config routes.
 * @param app - App.
 */
export async function configRoutes(app: FastifyInstance) {
  const controller = container.resolve(ConfigController);

  app.get('/api/config/roles', (req, reply) => controller.getRoles(req, reply));
  app.get('/api/config/chains', (req, reply) => controller.getChains(req, reply));
  app.put('/api/config/chains', (req, reply) => controller.updateChains(req, reply));
  app.get('/api/config/routing', (req, reply) => controller.getRouting(req, reply));
  app.put('/api/config/routing', (req, reply) => controller.updateRouting(req, reply));
  app.get('/api/config/overrides', (req, reply) => controller.getOverrides(req, reply));
  app.put('/api/config/overrides', (req, reply) => controller.updateOverrides(req, reply));
  app.get('/api/config/soul', (req, reply) => controller.getSoul(req, reply));
  app.put('/api/config/soul', (req, reply) => controller.updateSoul(req, reply));

  app.get('/api/schedules', (req, reply) => controller.getSchedules(req, reply));
  app.put('/api/schedules', (req, reply) => controller.updateSchedules(req, reply));
}
