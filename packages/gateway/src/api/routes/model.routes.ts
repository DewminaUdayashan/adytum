import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { ModelController } from '../controllers/model.controller.js';

export async function modelRoutes(app: FastifyInstance) {
  const controller = container.resolve(ModelController);

  app.get('/api/models', (req, reply) => controller.getModels(req, reply));
  app.post('/api/models', (req, reply) => controller.addModel(req, reply));
  app.put('/api/models/:id', (req, reply) => controller.updateModel(req, reply));
  app.delete('/api/models/:id', (req, reply) => controller.removeModel(req, reply));
  app.post('/api/models/scan', (req, reply) => controller.scanLocalModels(req, reply));
}
