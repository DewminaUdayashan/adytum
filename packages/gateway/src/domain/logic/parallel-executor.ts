import { singleton, inject } from 'tsyringe';
import { Plan, PlanStep } from '@adytum/shared';
import { ToolRegistry } from '../../tools/registry.js';
import { logger } from '../../logger.js';

import { ToolErrorHandler } from './tool-error-handler.js';

@singleton()
export class ParallelExecutor {
  constructor(
    @inject(ToolRegistry) private toolRegistry: ToolRegistry,
    @inject(ToolErrorHandler) private toolErrorHandler: ToolErrorHandler,
  ) {}

  async execute(plan: Plan, context: any = {}): Promise<Record<string, any>> {
    logger.debug({ goal: plan.goal }, 'ParallelExecutor: Starting execution');

    const results: Record<string, any> = {};
    const pending = new Set<PlanStep>(plan.steps);
    const completed = new Set<string>();
    const processing = new Set<string>();

    // Basic loop for now - strictly waits for dependencies.
    // In a real DAG engine, we'd use a more event-driven approach or Promise.allSettled on batches.

    while (pending.size > 0) {
      const canExecute: PlanStep[] = [];

      for (const step of pending) {
        if (processing.has(step.id)) continue;

        const depsMet = step.dependencies.every((depId: string) => completed.has(depId));
        if (depsMet) {
          canExecute.push(step);
        }
      }

      if (canExecute.length === 0 && processing.size === 0) {
        // Deadlock or circular dependency
        throw new Error('Plan execution gridlock: dependencies cannot be resolved.');
      }

      if (canExecute.length === 0) {
        // Wait for currently processing tasks
        await new Promise((resolve) => setTimeout(resolve, 100));
        continue;
      }

      // Execute batch in parallel
      const promises = canExecute.map(async (step) => {
        pending.delete(step);
        processing.add(step.id);

        try {
          logger.debug({ stepId: step.id }, 'Executing step');
          const result = await this.executeStep(step, context, results);
          results[step.id] = result;
          completed.add(step.id);
        } catch (err: any) {
          logger.error({ err, stepId: step.id }, 'Step execution failed');

          // Enhance error with recovery suggestions
          const errorMsg = err.message || String(err);
          const analysis = this.toolErrorHandler.analyze(errorMsg, step.tool || 'unknown', 1);
          const enhancedMsg = this.toolErrorHandler.formatErrorForContext(
            { message: errorMsg },
            analysis,
          );

          results[step.id] = {
            error: errorMsg,
            details: enhancedMsg,
            analysis,
          };

          // For now, we continue best-effort, or we could strict fail.
          // Marking as completed so dependents don't hang forever (though they might fail too).
          completed.add(step.id);
        } finally {
          processing.delete(step.id);
        }
      });

      await Promise.all(promises);
    }

    return results;
  }

  private async executeStep(
    step: PlanStep,
    context: any,
    priorResults: Record<string, any>,
  ): Promise<any> {
    if (!step.tool) {
      // If no tool, maybe it's just a thinking step or manual note.
      return { status: 'skipped', reason: 'no_tool_specified' };
    }

    const toolDef = this.toolRegistry.get(step.tool);
    if (!toolDef) {
      throw new Error(`Tool '${step.tool}' not found.`);
    }

    // TODO: Resolve arguments that reference prior results (e.g. "$step_1.output")
    // For now, assume args are static or injected by caller context.
    const args = step.args || {};

    return toolDef.execute(args);
  }
}
