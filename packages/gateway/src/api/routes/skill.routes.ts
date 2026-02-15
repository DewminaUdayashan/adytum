/**
 * @file packages/gateway/src/api/routes/skill.routes.ts
 * @description Defines API route registration and endpoint wiring.
 */

import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { SkillController } from '../controllers/skill.controller.js';

/**
 * Executes skill routes.
 * @param app - App.
 */
export async function skillRoutes(app: FastifyInstance) {
  const controller = container.resolve(SkillController);

  app.get('/api/skills', (req, reply) => controller.getSkills(req, reply));
  app.get('/api/skills/:id', (req, reply) => controller.getSkill(req, reply));
  app.put('/api/skills/:id', (req, reply) => controller.updateSkill(req, reply));
  app.get('/api/skills/:id/instructions', (req, reply) =>
    controller.getSkillInstructions(req, reply),
  );
  app.put('/api/skills/:id/instructions', (req, reply) =>
    controller.updateSkillInstructions(req, reply),
  );
  app.put('/api/skills/:id/secrets', (req, reply) => controller.updateSkillSecrets(req, reply));
  app.post('/api/skills/:id/oauth/google/start', (req, reply) =>
    controller.startEmailCalendarGoogleOAuth(req, reply),
  );
  app.get('/api/skills/:id/oauth/google/callback', (req, reply) =>
    controller.handleEmailCalendarGoogleOAuthCallback(req, reply),
  );
  app.get('/api/skills/:id/oauth/google/status', (req, reply) =>
    controller.getEmailCalendarGoogleOAuthStatus(req, reply),
  );
  app.get('/api/skills/:id/oauth/google/accounts', (req, reply) =>
    controller.listEmailCalendarGoogleOAuthAccounts(req, reply),
  );
  app.delete('/api/skills/:id/oauth/google/accounts/:accountId', (req, reply) =>
    controller.removeEmailCalendarAccount(req, reply),
  );
}
