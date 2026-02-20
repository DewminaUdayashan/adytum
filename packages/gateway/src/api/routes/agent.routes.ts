/**
 * @file packages/gateway/src/api/routes/agent.routes.ts
 * @description Defines API route registration and endpoint wiring.
 */

import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { AgentController } from '../controllers/agent.controller.js';

/**
 * Executes agent routes.
 * @param app - App.
 */
export async function agentRoutes(app: FastifyInstance) {
  const controller = container.resolve(AgentController);

  // REST routes
  app.get('/api/memories', (req, reply) => controller.getMemories(req, reply));
  app.put('/api/memories/:id', (req, reply) => controller.updateMemory(req));
  app.delete('/api/memories/:id', (req, reply) => controller.deleteMemory(req));

  app.get('/api/approvals', (req, reply) => controller.getApprovals(req));
  app.post('/api/approvals/:id', (req, reply) => controller.resolveApproval(req));

  app.post('/api/feedback', (req, reply) => controller.handleFeedback(req));

  app.get('/api/personality', (req, reply) => controller.getPersonality(req));
  app.put('/api/personality', (req, reply) => controller.updatePersonality(req));

  app.get('/api/heartbeat', (req, reply) => controller.getHeartbeat(req));
  app.put('/api/heartbeat', (req, reply) => controller.updateHeartbeat(req));
}
