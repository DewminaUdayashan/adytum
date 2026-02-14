import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { TaskController } from '../controllers/task.controller.js';

export async function taskRoutes(app: FastifyInstance) {
  const controller = container.resolve(TaskController);

  app.get('/api/cron', (req, reply) => controller.getJobs(req, reply));
  app.post('/api/cron', (req, reply) => controller.createJob(req, reply));
  app.put('/api/cron/:id', (req, reply) => controller.updateJob(req, reply));
  app.delete('/api/cron/:id', (req, reply) => controller.deleteJob(req, reply));
}
