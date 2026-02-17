import { z } from 'zod';
import { ToolDefinition } from '@adytum/shared';
import { TaskPlanner } from '../domain/logic/task-planner.js';
import { ParallelExecutor } from '../domain/logic/parallel-executor.js';

export const createPlannerTools = (
  planner: TaskPlanner,
  executor: ParallelExecutor,
): ToolDefinition[] => {
  return [
    {
      name: 'task_and_execute',
      description: `
        Generates a multi-step plan for a complex goal and executes it (optionally in parallel).
        Use this when a user request involves multiple distinct steps or tools that can be parallelized.
        Example: "Research X, Y, and Z and summarize them." or "Check these 5 files for errors."
      `,
      parameters: z.object({
        goal: z.string().describe('The complex goal to achieve.'),
        context: z.string().optional().describe('Additional context or constraints.'),
      }),
      execute: async ({ goal, context }) => {
        const plan = await planner.plan(goal, context || '');

        // Execute the plan
        const results = await executor.execute(plan);

        // Merge results back into the plan for visualization
        const stepsWithResults = plan.steps.map((step) => {
          const result = results[step.id];
          if (result) {
            return {
              ...step,
              status: result.status,
              result: JSON.stringify(result.result),
              error: result.error,
            };
          }
          return step;
        });
        const executedPlan = { ...plan, steps: stepsWithResults };

        // Format the final report
        const report = Object.entries(results)
          .map(
            ([stepId, r]: [string, any]) =>
              `- **${stepId}**: ${r.status || 'completed'} ${r.error ? `(Error: ${r.error})` : ''}\n  Result: ${JSON.stringify(r.result || r)}`,
          )
          .join('\n');

        // Return a structured response that the dashboard can parse
        // We embed the JSON plan in a special block for the visualizer
        return `
\`\`\`plan
${JSON.stringify(executedPlan, null, 2)}
\`\`\`

## Execution Report
${report}
        `.trim();
      },
    },
  ];
};
