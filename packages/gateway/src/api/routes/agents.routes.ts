/**
 * @file packages/gateway/src/api/routes/agents.routes.ts
 * @description Hierarchical multi-agent API routes.
 */

import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { AgentsController } from '../controllers/agents.controller.js';

export async function agentsRoutes(app: FastifyInstance) {
  const controller = container.resolve(AgentsController);

  app.get('/api/agents', (req, reply) => controller.list(req, reply));
  app.get('/api/agents/hierarchy', (req, reply) => controller.hierarchy(req, reply));
  app.get('/api/agents/graveyard', (req, reply) => controller.graveyard(req, reply));
  app.get('/api/agents/logbook', (req, reply) => controller.getLogbook(req, reply));
  app.get('/api/agents/settings', (req, reply) => controller.getSettings(req, reply));
  app.put('/api/agents/settings', (req, reply) => controller.updateSettings(req, reply));
  app.post('/api/agents/birth', (req, reply) => controller.birth(req, reply));
  app.post('/api/agents/deactivate-all-subagents', (req, reply) =>
    controller.deactivateAllSubagents(req, reply),
  );
  app.get('/api/agents/:id', (req, reply) => controller.get(req, reply));
  app.patch('/api/agents/:id', (req, reply) => controller.update(req, reply));
  app.post('/api/agents/:id/death', (req, reply) => controller.death(req, reply));
  app.get('/api/agents/:id/logs', (req, reply) => controller.getAgentLogs(req, reply));
}
