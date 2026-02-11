import { z } from 'zod';
import type { ToolDefinition } from '@adytum/shared';
import type { CronManager } from '../agent/cron-manager.js';
import cron from 'node-cron';

const CronScheduleSchema = z.object({
  schedule: z.string().describe('Cron expression (e.g. "0 5 * * *" for daily at 5am)'),
  taskDescription: z.string().describe('Description of what to do (e.g. "Search for AI news")'),
  name: z.string().describe('Unique name for this job'),
});

const CronListSchema = z.object({});
const CronRemoveSchema = z.object({
  name_or_id: z.string().describe('Name OR ID of the job to remove'),
});

export function createCronTools(cronManager: CronManager): ToolDefinition[] {
  return [
    {
      name: 'cron_schedule',
      description: 'Schedule a recurring task. Persists across restarts.',
      parameters: CronScheduleSchema,
      execute: async (args: unknown) => {
        const { schedule, taskDescription, name } = CronScheduleSchema.parse(args);

        if (!cron.validate(schedule)) {
          return `Invalid cron expression: "${schedule}"`;
        }

        // Check availability
        const existing = cronManager.getAllJobs().find(j => j.name === name);
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
         
         return jobs.map(j => 
             `- [${j.enabled ? 'ACTIVE' : 'PAUSED'}] ${j.name} (${j.schedule}): ${j.task} (ID: ${j.id})`
         ).join('\n');
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
            job = cronManager.getAllJobs().find(j => j.name === name_or_id);
        }

        if (!job) return `Job "${name_or_id}" not found.`;
        
        cronManager.removeJob(job.id);
        return `Job "${job.name}" removed.`;
      },
    },
  ];
}
