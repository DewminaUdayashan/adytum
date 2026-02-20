/**
 * @file packages/gateway/src/tools/cron.ts
 * @description Cron tools exposed to the agent runtime.
 *              Includes schedule, list, remove, trigger, status, pause, resume.
 */

import { z } from 'zod';
import type { ToolDefinition } from '@adytum/shared';
import type { CronManager } from '../application/services/cron-manager.js';
import cron from 'node-cron';

const CronScheduleSchema = z.object({
  schedule: z.string().describe('Cron expression (e.g. "0 5 * * *" for daily at 5am)'),
  taskDescription: z
    .string()
    .describe(
      'Full execution instruction for when the job runs (e.g. "Run daily report pipeline: spawn Tier 2 to aggregate and write report" or "Check monitoring and send alert if needed")',
    ),
  name: z.string().describe('Unique name for this job'),
  timeoutSeconds: z
    .number()
    .optional()
    .describe('Max execution time in seconds (default 600). 0 = no timeout.'),
  wakeMode: z
    .enum(['next-heartbeat', 'now'])
    .optional()
    .describe('Whether to wake the agent immediately on trigger. Default "next-heartbeat".'),
  runOnce: z
    .boolean()
    .optional()
    .describe('If true, the job runs once and auto-disables. Default false.'),
});

const CronIdSchema = z.object({
  name_or_id: z.string().describe('Name OR ID of the job'),
});

/**
 * Creates cron tools.
 */
export function createCronTools(cronManager: CronManager): ToolDefinition[] {
  // Helper to find job by name or id
  const findJob = (nameOrId: string) => {
    let job = cronManager.getJob(nameOrId);
    if (!job) {
      job = cronManager.getAllJobs().find((j) => j.name === nameOrId);
    }
    return job;
  };

  return [
    {
      name: 'cron_schedule',
      description:
        'Schedule a recurring task. Persists across restarts. PRE-REQUISITES: 1. If a delivery channel is specified (e.g. "Discord"), VERIFY the skill/config exists first. 2. If NO delivery channel is specified for a notification task, ASK the user for their preference before scheduling.',
      parameters: CronScheduleSchema,
      execute: async (args: unknown) => {
        const { schedule, taskDescription, name, timeoutSeconds, wakeMode, runOnce } =
          CronScheduleSchema.parse(args);

        if (!cron.validate(schedule)) {
          return `Invalid cron expression: "${schedule}"`;
        }

        const existing = cronManager.getAllJobs().find((j) => j.name === name);
        if (existing) {
          return `Job with name "${name}" already exists (ID: ${existing.id}). Remove it first or use a unique name.`;
        }

        const job = cronManager.addJob(name, schedule, taskDescription, undefined, {
          timeoutSeconds,
          wakeMode,
          runOnce,
        });

        return `Scheduled job "${name}" (ID: ${job.id}) with schedule "${schedule}".${
          timeoutSeconds ? ` Timeout: ${timeoutSeconds}s.` : ''
        }${runOnce ? ' (ONE-SHOT: will auto-disable after first run)' : ''}`;
      },
    },
    {
      name: 'cron_list',
      description: 'List all cron jobs with their current status.',
      parameters: z.object({}),
      execute: async () => {
        const jobs = cronManager.getAllJobs();
        if (jobs.length === 0) return 'No cron jobs.';

        return jobs
          .map((j) => {
            const s = j.state;
            const statusTag = j.enabled ? 'ACTIVE' : 'PAUSED';
            const errTag = s.consecutiveErrors > 0 ? ` ⚠️ ${s.consecutiveErrors} errors` : '';
            const lastRun = s.lastRunAtMs
              ? ` | Last: ${new Date(s.lastRunAtMs).toISOString()} (${s.lastStatus || '?'})`
              : '';
            const running = s.runningAtMs ? ' | 🔄 RUNNING' : '';
            return `- [${statusTag}] ${j.name} (${j.schedule}): ${j.task.slice(0, 80)}${running}${lastRun}${errTag} (ID: ${j.id})`;
          })
          .join('\n');
      },
    },
    {
      name: 'cron_remove',
      description: 'Stop and remove a cron job.',
      parameters: CronIdSchema,
      execute: async (args: unknown) => {
        const { name_or_id } = CronIdSchema.parse(args);
        const job = findJob(name_or_id);
        if (!job) return `Job "${name_or_id}" not found.`;

        cronManager.removeJob(job.id);
        return `Job "${job.name}" removed.`;
      },
    },
    {
      name: 'cron_trigger',
      description:
        'Manually trigger a cron job immediately. Bypasses schedule and backoff. Fails if the job is currently running.',
      parameters: CronIdSchema,
      execute: async (args: unknown) => {
        const { name_or_id } = CronIdSchema.parse(args);
        const job = findJob(name_or_id);
        if (!job) return `Job "${name_or_id}" not found.`;

        try {
          const summary = await cronManager.triggerJob(job.id);
          return `Job "${job.name}" triggered successfully.\nSummary: ${summary}`;
        } catch (e: any) {
          return `Job "${job.name}" failed: ${e.message}`;
        }
      },
    },
    {
      name: 'cron_status',
      description:
        'Get detailed status of a cron job, including last run time, errors, backoff state, and duration.',
      parameters: CronIdSchema,
      execute: async (args: unknown) => {
        const { name_or_id } = CronIdSchema.parse(args);
        const job = findJob(name_or_id);
        if (!job) return `Job "${name_or_id}" not found.`;

        return cronManager.getJobStatus(job.id);
      },
    },
    {
      name: 'cron_pause',
      description: 'Pause a cron job without removing it. The job can be resumed later.',
      parameters: CronIdSchema,
      execute: async (args: unknown) => {
        const { name_or_id } = CronIdSchema.parse(args);
        const job = findJob(name_or_id);
        if (!job) return `Job "${name_or_id}" not found.`;

        cronManager.pauseJob(job.id);
        return `Job "${job.name}" paused.`;
      },
    },
    {
      name: 'cron_resume',
      description:
        'Resume a paused cron job. Resets any error backoff so the job runs on its next scheduled tick.',
      parameters: CronIdSchema,
      execute: async (args: unknown) => {
        const { name_or_id } = CronIdSchema.parse(args);
        const job = findJob(name_or_id);
        if (!job) return `Job "${name_or_id}" not found.`;

        if (job.enabled) return `Job "${job.name}" is already active.`;

        cronManager.resumeJob(job.id);
        return `Job "${job.name}" resumed. Error backoff has been reset.`;
      },
    },
  ];
}
