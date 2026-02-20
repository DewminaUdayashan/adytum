/**
 * @file packages/gateway/src/application/services/cron-manager.ts
 * @description Implements application-level service logic and coordination.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import cron from 'node-cron';
import { z } from 'zod';
import type { AgentRuntime } from '../../domain/logic/agent-runtime.js';
import type { LogbookService } from './logbook-service.js';
import type { RuntimeRegistry } from '../../domain/agents/runtime-registry.js';

export const CronJobSchema = z.object({
  id: z.string(),
  name: z.string(),
  schedule: z.string(), // Cron expression
  task: z.string(), // Prompt/Instruction for the agent
  targetAgentId: z.string().optional(), // [NEW] The specific agent to run this task on
  systemPrompt: z.string().optional(), // Optional system prompt override
  enabled: z.boolean().default(true),
  lastRun: z.number().optional(),
  createdAt: z.number(),
});

export type CronJob = z.infer<typeof CronJobSchema>;

/**
 * Encapsulates cron manager behavior.
 */
export class CronManager {
  private jobs = new Map<string, CronJob>();
  private tasks = new Map<string, cron.ScheduledTask>();
  private filePath: string;

  constructor(
    private agent: AgentRuntime,
    private dataPath: string,
    private runtimeRegistry: RuntimeRegistry,
    private logbook?: LogbookService,
  ) {
    this.filePath = join(this.dataPath, 'cron.json');
    this.load();
  }

  /**
   * Executes load.
   */
  private load() {
    if (!existsSync(this.filePath)) {
      this.jobs.clear();
      return;
    }

    try {
      const data = JSON.parse(readFileSync(this.filePath, 'utf-8'));
      const parsed = z.array(CronJobSchema).parse(data);

      this.jobs.clear();
      for (const job of parsed) {
        this.jobs.set(job.id, job);
        if (job.enabled) {
          this.schedule(job);
        }
      }
    } catch (error) {
      console.error('Failed to load cron jobs:', error);
    }
  }

  /**
   * Executes save.
   */
  private save() {
    try {
      const data = Array.from(this.jobs.values());
      writeFileSync(this.filePath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('Failed to save cron jobs:', error);
    }
  }

  /**
   * Executes schedule.
   * @param job - Job.
   */
  private schedule(job: CronJob) {
    if (this.tasks.has(job.id)) {
      this.tasks.get(job.id)?.stop();
    }

    if (!job.enabled) return;

    if (!cron.validate(job.schedule)) {
      console.error(`Invalid cron schedule for job ${job.name}: ${job.schedule}`);
      return;
    }

    const task = cron.schedule(job.schedule, async () => {
      console.log(`[Cron] Running job: ${job.name}`);

      // Update last run info
      const current = this.jobs.get(job.id);
      if (current) {
        current.lastRun = Date.now();
        this.save();
      }

      await this.executeJob(job);
    });

    this.tasks.set(job.id, task);
  }

  /**
   * Executes the core logic of a cron job.
   * Extracted for reuse by manual triggers.
   */
  private async executeJob(job: CronJob): Promise<string> {
    try {
      const sessionId = `cron-${job.id}`;
      // Use targetAgentId if provided, otherwise fallback to main Architect
      const agentId = job.targetAgentId || this.agent.getAgentId();

      const prompt = `[CRON JOB TRIGGERED: ${job.name}]

Required Action: ${job.task}

EXECUTION GUIDELINES (PROTOCOL DYNAMO-01):
1. META-INSTRUCTION: You are the MANAGER (Tier 2). Your goal is to execute the user's request, but you must first PLAN.
2. AMBIGUITY CHECK: Do you have concrete targets (URLs, specific IDs, filenames)?
   - IF NO: Do NOT spawn "generic" workers. Spawn a Tier 3 Scout/Researcher first to find the targets.
   - IF YES: Proceed to spawn Execution Agents.
3. BATCHING: Once you have targets, use 'spawn_sub_agent' with the 'batch' parameter to spawn all workers in PARALLEL.
4. PERSISTENCE (CRITICAL FOR DAILY JOBS):
   - You MUST spawn your Tier 2/3 sub-agents with 'deactivate_after: false' so they persist for the next run.
   - NAMING: Use *ONLY* a single-word CATCHY CALLSIGN (e.g., "Viper", "Cobalt", "Nebula", "Onyx"). 
     - FORBIDDEN: Do NOT use "Agent-", "Weather-", "Scout-", or any descriptive prefix.
     - CORRECT: "Viper"
     - INCORRECT: "Agent-Viper", "Weather-Scout-Galle"
     - Make them sound like a specialized operative team.
   - If they already exist, the system will reuse them.
   - IGNORE any user instruction to "deactivate" if this is a recurring job. KEEP AGENTS ALIVE.
5. AGGREGATION: Wait for all results, then compile the final report.

When done, reply with a brief summary: status (OK/failed), what was done, any errors.`;

      const result = await this.agent.run(prompt, sessionId, {
        agentId,
        agentMode: 'scheduled',
      });

      const summary = (result?.response ?? '').trim().slice(0, 600);
      if (this.logbook && summary) {
        this.logbook.append({
          timestamp: Date.now(),
          event: 'cron_complete',
          detail: `[${job.name}] ${summary}`,
        });
      }
      return summary;
    } catch (err) {
      console.error(`[Cron] Job ${job.name} failed:`, err);
      if (this.logbook) {
        this.logbook.append({
          timestamp: Date.now(),
          event: 'cron_failed',
          detail: `[${job.name}] ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      throw err;
    }
  }

  // ── Public API ────────────────────────────────────────────────

  /**
   * Manually triggers a job by ID.
   */
  async triggerJob(id: string): Promise<string> {
    const job = this.jobs.get(id);
    if (!job) throw new Error(`Job ${id} not found`);

    console.log(`[Cron] Manual trigger for job: ${job.name}`);
    return this.executeJob(job);
  }

  /**
   * Executes add job.
   * @param name - Name.
   * @param schedule - Schedule.
   * @param taskDescription - Task description.
   * @param targetAgentId - Optional target agent ID.
   * @returns The add job result.
   */
  addJob(name: string, schedule: string, taskDescription: string, targetAgentId?: string): CronJob {
    const id = crypto.randomUUID();
    const job: CronJob = {
      id,
      name,
      schedule,
      task: taskDescription,
      targetAgentId,
      systemPrompt: `You are an automated Cron Agent. Your goal is to execute the user's scheduled task efficiently.

RULES:
1. BATCHING: For multi-step independent tasks, ALWAYS use the 'batch' parameter in 'spawn_sub_agent' to run them in PARALLEL.
2. RESOURCEFULNESS: Assign appropriate models based on task complexity. Use efficient models for simple data processing and powerful models for complex reasoning.
3. CONTINUITY: If the task is part of a recurring workflow, check if a persistent agent session exists that you can resume or reuse.
`,
      enabled: true,
      createdAt: Date.now(),
    };

    this.jobs.set(id, job);
    this.save();
    this.schedule(job);
    return job;
  }

  /**
   * Executes update job.
   * @param id - Id.
   * @param updates - Updates.
   * @returns The update job result.
   */
  updateJob(id: string, updates: Partial<Omit<CronJob, 'id' | 'createdAt'>>): CronJob {
    const job = this.jobs.get(id);
    if (!job) throw new Error(`Job ${id} not found`);

    const updated = { ...job, ...updates };
    this.jobs.set(id, updated);
    this.save();

    // Re-schedule if needed
    if (updates.schedule || updates.enabled !== undefined) {
      this.tasks.get(id)?.stop();
      // Abort any running instances of this job
      const sessionId = `cron-${id}`;
      this.runtimeRegistry.abortHierarchy(sessionId);

      if (updated.enabled) {
        this.schedule(updated);
      }
    }

    return updated;
  }

  /**
   * Executes remove job.
   * @param id - Id.
   */
  removeJob(id: string) {
    this.tasks.get(id)?.stop();
    // Kill any running agents
    const sessionId = `cron-${id}`;
    this.runtimeRegistry.abortHierarchy(sessionId);

    this.tasks.delete(id);
    this.tasks.delete(id);
    this.jobs.delete(id);
    this.save();
  }

  /**
   * Retrieves job.
   * @param id - Id.
   */
  getJob(id: string) {
    return this.jobs.get(id);
  }

  /**
   * Retrieves all jobs.
   * @returns The resulting collection of values.
   */
  getAllJobs(): CronJob[] {
    return Array.from(this.jobs.values());
  }
}
