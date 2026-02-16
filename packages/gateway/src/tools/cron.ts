/**
 * @file packages/gateway/src/tools/cron.ts
 * @description Defines tool handlers exposed to the runtime.
 */

import { z } from 'zod';
import type { ToolDefinition } from '@adytum/shared';
import type { CronManager } from '../application/services/cron-manager.js';
import cron from 'node-cron';

const CronScheduleSchema = z.object({
  schedule: z.string().describe('Cron expression (e.g. "0 5 * * *" for daily at 5am)'),
  taskDescription: z.string().describe('Full execution instruction for when the job runs (e.g. "Run daily report pipeline: spawn Tier 2 to aggregate and write report" or "Check monitoring and send alert if needed")'),
  name: z.string().describe('Unique name for this job'),
});

const CronListSchema = z.object({});
const CronRemoveSchema = z.object({
  name_or_id: z.string().describe('Name OR ID of the job to remove'),
});

/**
 * Creates cron tools.
 * @param cronManager - Cron manager.
 * @returns The resulting collection of values.
 */
export function createCronTools(cronManager: CronManager): ToolDefinition[] {
  return [
    {
      name: 'cron_schedule',
      description: 'Schedule a recurring task. Persists across restarts. PRE-REQUISITES: 1. If a delivery channel is specified (e.g. "Discord"), VERIFY the skill/config exists first. 2. If NO delivery channel is specified for a notification task, ASK the user for their preference before scheduling.',
      parameters: CronScheduleSchema,
      execute: async (args: unknown) => {
        const { schedule, taskDescription, name } = CronScheduleSchema.parse(args);

        if (!cron.validate(schedule)) {
          return `Invalid cron expression: "${schedule}"`;
        }

        // Check availability
        const existing = cronManager.getAllJobs().find((j) => j.name === name);
        if (existing) {
          return `Job with name "${name}" already exists (ID: ${existing.id}). Remove it first or use a unique name.`;
        }

        const job = cronManager.addJob(name, schedule, taskDescription);
        return `Scheduled job "${name}" (ID: ${job.id}) with schedule "${schedule}".`;
      },
    },
    {
      name: 'cron_list',
      description: 'List all active cron jobs.',
      parameters: CronListSchema,
      execute: async () => {
        const jobs = cronManager.getAllJobs();
        if (jobs.length === 0) return 'No active cron jobs.';

        return jobs
          .map(
            (j) =>
              `- [${j.enabled ? 'ACTIVE' : 'PAUSED'}] ${j.name} (${j.schedule}): ${j.task} (ID: ${j.id})`,
          )
          .join('\n');
      },
    },
    {
      name: 'cron_remove',
      description: 'Stop and remove a cron job.',
      parameters: CronRemoveSchema,
      execute: async (args: unknown) => {
        const { name_or_id } = CronRemoveSchema.parse(args);

        let job = cronManager.getJob(name_or_id);
        if (!job) {
          // Try searching by name
          job = cronManager.getAllJobs().find((j) => j.name === name_or_id);
        }

        if (!job) return `Job "${name_or_id}" not found.`;

        cronManager.removeJob(job.id);
        return `Job "${job.name}" removed.`;
      },
    },
  ];
}
