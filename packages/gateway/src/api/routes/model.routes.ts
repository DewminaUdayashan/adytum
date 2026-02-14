/**
 * @file packages/gateway/src/api/routes/model.routes.ts
 * @description Defines API route registration and endpoint wiring.
 */

import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { ModelController } from '../controllers/model.controller.js';

/**
 * Executes model routes.
 * @param app - App.
 */
export async function modelRoutes(app: FastifyInstance) {
  const controller = container.resolve(ModelController);

  app.get('/api/models', (req, reply) => controller.getModels(req, reply));
  app.post('/api/models', (req, reply) => controller.addModel(req, reply));
  app.put('/api/models/:id', (req, reply) => controller.updateModel(req, reply));
  app.delete('/api/models/:id', (req, reply) => controller.removeModel(req, reply));
  app.post('/api/models/scan', (req, reply) => controller.scanLocalModels(req, reply));
}
