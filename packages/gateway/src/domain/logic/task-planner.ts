import { singleton, inject } from 'tsyringe';
import { ModelRouter } from '../../infrastructure/llm/model-router.js';
import { z } from 'zod';
import { logger } from '../../logger.js';

import { Plan, PlanSchema, PlanStepSchema } from '@adytum/shared';

// Removed local definitions since they are now in shared

@singleton()
export class TaskPlanner {
  constructor(@inject(ModelRouter) private modelRouter: ModelRouter) {}

  async plan(goal: string, context: string = ''): Promise<Plan> {
    logger.info({ goal }, 'TaskPlanner: Generating plan');

    const prompt = `
You are an expert autonomous agent planner.
Your goal is to break down the user's request into a structured execution plan.
Users request: "${goal}"

Context:
${context}

Rules:
1. Break the task into small, logical steps.
2. Identify dependencies (e.g., step B needs output from step A).
3. Identify which tool to use for each step if obvious (optional).
4. Output MUST be valid JSON matching this schema:
{
  "goal": "string",
  "steps": [
    {
      "id": "step_1",
      "description": "Fetch data from X",
      "tool": "web_fetch", // optional
      "args": { "url": "..." }, // optional
      "dependencies": [] // list of step IDs that must complete first
    }
  ]
}

Return ONLY JSON. No markdown blocking.
    `;

    try {
      const result = await this.modelRouter.chat('thinking', [{ role: 'user', content: prompt }], {
        temperature: 0.2,
      });
      const response = result.message;

      const content = result.message.content;
      if (!content) {
        throw new Error('Model returned empty plan.');
      }

      const cleanJson = content.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(cleanJson);
      return PlanSchema.parse(parsed);
    } catch (error: any) {
      logger.error({ err: error }, 'TaskPlanner failed to generate plan');
      throw new Error(`Failed to generate plan: ${error.message}`);
    }
  }
}
