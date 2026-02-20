/**
 * @file packages/gateway/src/application/services/cron-manager.ts
 * @description Hardened cron job scheduler with exponential backoff, error tracking,
 *              per-job timeouts, run-in-progress guards, and one-shot job support.
 *              Inspired by OpenClaw's production-proven cron timer patterns.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import cron from 'node-cron';
import { z } from 'zod';
import type { AgentRuntime } from '../../domain/logic/agent-runtime.js';
import type { LogbookService } from './logbook-service.js';
import type { RuntimeRegistry } from '../../domain/agents/runtime-registry.js';
import type { HeartbeatManager } from './heartbeat-manager.js';

// ── Backoff schedule (ms) indexed by consecutive error count ──────────────
const ERROR_BACKOFF_SCHEDULE_MS = [
  30_000, // 1st error  →  30 s
  60_000, // 2nd error  →   1 min
  5 * 60_000, // 3rd error  →   5 min
  15 * 60_000, // 4th error  →  15 min
  60 * 60_000, // 5th+ error →  60 min
] as const;

function errorBackoffMs(consecutiveErrors: number): number {
  const idx = Math.min(consecutiveErrors - 1, ERROR_BACKOFF_SCHEDULE_MS.length - 1);
  return ERROR_BACKOFF_SCHEDULE_MS[Math.max(0, idx)];
}

// ── Constants ────────────────────────────────────────────────────────────
const DEFAULT_JOB_TIMEOUT_MS = 10 * 60_000; // 10 minutes
const MIN_REFIRE_GAP_MS = 2_000; // Prevent spin-loops

// ── Job State Schema ─────────────────────────────────────────────────────
const CronJobStateSchema = z.object({
  lastRunAtMs: z.number().optional(),
  lastStatus: z.enum(['ok', 'error', 'skipped', 'timeout']).optional(),
  lastError: z.string().optional(),
  lastDurationMs: z.number().optional(),
  consecutiveErrors: z.number().default(0),
  runningAtMs: z.number().optional(), // Set when job starts, cleared when done
  nextRunAtMs: z.number().optional(), // When the next run is scheduled (for backoff)
});

export type CronJobState = z.infer<typeof CronJobStateSchema>;

export const CronJobSchema = z.object({
  id: z.string(),
  name: z.string(),
  schedule: z.string(), // Cron expression OR 'at:<timestamp>' for one-shot
  scheduleKind: z.enum(['cron', 'at']).default('cron'),
  task: z.string(), // Prompt/Instruction for the agent
  targetAgentId: z.string().optional(),
  systemPrompt: z.string().optional(),
  enabled: z.boolean().default(true),
  timeoutSeconds: z.number().optional(), // Per-job timeout (default 600s / 10min)
  wakeMode: z.enum(['next-heartbeat', 'now']).default('next-heartbeat'),
  deleteAfterRun: z.boolean().optional(), // For one-shot jobs
  createdAt: z.number(),
  // Legacy field kept for backward compatibility
  lastRun: z.number().optional(),
  // New: structured job state
  state: CronJobStateSchema.default({
    consecutiveErrors: 0,
  }),
});

export type CronJob = z.infer<typeof CronJobSchema>;

/**
 * Hardened cron manager with error recovery, backoff, and production guards.
 */
export class CronManager {
  private jobs = new Map<string, CronJob>();
  private tasks = new Map<string, cron.ScheduledTask>();
  private filePath: string;
  private heartbeat?: HeartbeatManager;

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
   * Sets the heartbeat manager for cron ↔ heartbeat integration.
   */
  setHeartbeat(heartbeat: HeartbeatManager): void {
    this.heartbeat = heartbeat;
  }

  // ── Persistence ─────────────────────────────────────────────────────

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
        // Clear stale running states from previous process
        if (job.state.runningAtMs) {
          job.state.runningAtMs = undefined;
        }
        this.jobs.set(job.id, job);
        if (job.enabled && job.scheduleKind === 'cron') {
          this.schedule(job);
        }
      }

      console.log(`[Cron] Loaded ${parsed.length} jobs.`);
    } catch (error) {
      console.error('[Cron] Failed to load cron jobs:', error);
    }
  }

  private save() {
    try {
      const data = Array.from(this.jobs.values());
      writeFileSync(this.filePath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('[Cron] Failed to save cron jobs:', error);
    }
  }

  // ── Scheduling ──────────────────────────────────────────────────────

  private schedule(job: CronJob) {
    if (this.tasks.has(job.id)) {
      this.tasks.get(job.id)?.stop();
    }

    if (!job.enabled) return;

    if (!cron.validate(job.schedule)) {
      console.error(`[Cron] Invalid cron schedule for job ${job.name}: ${job.schedule}`);
      return;
    }

    const task = cron.schedule(job.schedule, async () => {
      // Refresh job state from memory (another tick may have updated it)
      const current = this.jobs.get(job.id);
      if (!current || !current.enabled) return;

      // ── Run-in-progress guard ───────────────────────────
      if (current.state.runningAtMs) {
        console.log(`[Cron] Job "${current.name}" is already running, skipping tick.`);
        return;
      }

      // ── Backoff guard ───────────────────────────────────
      if (this.isInBackoff(current)) {
        const remaining = this.backoffRemainingMs(current);
        console.log(
          `[Cron] Job "${current.name}" in backoff (${current.state.consecutiveErrors} consecutive errors, ` +
            `${Math.ceil(remaining / 1000)}s remaining). Skipping.`,
        );
        return;
      }

      // ── Min refire gap guard ────────────────────────────
      if (current.state.lastRunAtMs && Date.now() - current.state.lastRunAtMs < MIN_REFIRE_GAP_MS) {
        return;
      }

      await this.executeAndApply(current);
    });

    this.tasks.set(job.id, task);
  }

  // ── Backoff Logic ───────────────────────────────────────────────────

  private isInBackoff(job: CronJob): boolean {
    if (job.state.consecutiveErrors <= 0) return false;
    if (!job.state.lastRunAtMs) return false;

    const backoff = errorBackoffMs(job.state.consecutiveErrors);
    const elapsed = Date.now() - job.state.lastRunAtMs;
    return elapsed < backoff;
  }

  private backoffRemainingMs(job: CronJob): number {
    if (job.state.consecutiveErrors <= 0 || !job.state.lastRunAtMs) return 0;
    const backoff = errorBackoffMs(job.state.consecutiveErrors);
    return Math.max(0, backoff - (Date.now() - job.state.lastRunAtMs));
  }

  // ── Job Execution ───────────────────────────────────────────────────

  /**
   * Execute a job and apply the result to its state.
   */
  private async executeAndApply(job: CronJob): Promise<string> {
    const startedAt = Date.now();
    job.state.runningAtMs = startedAt;
    job.state.lastError = undefined;
    this.save();

    console.log(`[Cron] ▶ Running job: ${job.name}`);

    let status: CronJobState['lastStatus'] = 'ok';
    let error: string | undefined;
    let summary = '';

    try {
      const timeoutMs = this.resolveTimeoutMs(job);
      summary = await this.executeWithTimeout(job, timeoutMs);
    } catch (err) {
      status = err instanceof Error && err.message.includes('timed out') ? 'timeout' : 'error';
      error = err instanceof Error ? err.message : String(err);
      console.error(`[Cron] Job "${job.name}" failed (${status}):`, error);

      if (this.logbook) {
        this.logbook.append({
          timestamp: Date.now(),
          event: 'cron_failed',
          detail: `[${job.name}] ${error}`,
        });
      }
    }

    // ── Apply result to job state ──────────────────────
    const endedAt = Date.now();
    job.state.runningAtMs = undefined;
    job.state.lastRunAtMs = startedAt;
    job.state.lastStatus = status;
    job.state.lastError = error;
    job.state.lastDurationMs = endedAt - startedAt;
    job.lastRun = startedAt; // backward compat

    if (status === 'error' || status === 'timeout') {
      job.state.consecutiveErrors = (job.state.consecutiveErrors || 0) + 1;
      const backoff = errorBackoffMs(job.state.consecutiveErrors);
      console.log(
        `[Cron] Job "${job.name}" — ${job.state.consecutiveErrors} consecutive errors. ` +
          `Next retry in ${Math.ceil(backoff / 1000)}s.`,
      );
    } else {
      // Reset on success
      job.state.consecutiveErrors = 0;
    }

    // ── One-shot job handling ──────────────────────────
    if (job.scheduleKind === 'at') {
      if (job.deleteAfterRun && status === 'ok') {
        this.removeJob(job.id);
        console.log(`[Cron] One-shot job "${job.name}" completed and deleted.`);
        return summary;
      } else {
        // Disable one-shot jobs after any terminal status
        job.enabled = false;
        this.tasks.get(job.id)?.stop();
        this.tasks.delete(job.id);
      }
    }

    this.save();

    if (this.logbook && summary && status === 'ok') {
      this.logbook.append({
        timestamp: Date.now(),
        event: 'cron_complete',
        detail: `[${job.name}] ${summary.slice(0, 600)}`,
      });
    }

    return summary;
  }

  /**
   * Execute with a timeout race.
   */
  private async executeWithTimeout(job: CronJob, timeoutMs: number): Promise<string> {
    let timeoutId: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        this.executeJobCore(job),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(
            () =>
              reject(
                new Error(`Job "${job.name}" timed out after ${Math.ceil(timeoutMs / 1000)}s`),
              ),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  private resolveTimeoutMs(job: CronJob): number {
    if (typeof job.timeoutSeconds === 'number' && job.timeoutSeconds > 0) {
      return Math.floor(job.timeoutSeconds * 1000);
    }
    return DEFAULT_JOB_TIMEOUT_MS;
  }

  /**
   * Core execution logic — runs the agent with the job's task.
   */
  private async executeJobCore(job: CronJob): Promise<string> {
    const sessionId = `cron-${job.id}`;
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

    return (result?.response ?? '').trim().slice(0, 600);
  }

  // ── Public API ────────────────────────────────────────────────────

  /**
   * Manually triggers a job by ID — bypasses backoff and schedule.
   */
  async triggerJob(id: string): Promise<string> {
    const job = this.jobs.get(id);
    if (!job) throw new Error(`Job ${id} not found`);

    if (job.state.runningAtMs) {
      throw new Error(
        `Job "${job.name}" is already running (started at ${new Date(job.state.runningAtMs).toISOString()})`,
      );
    }

    console.log(`[Cron] Manual trigger for job: ${job.name}`);
    return this.executeAndApply(job);
  }

  /**
   * Add a new cron job.
   */
  addJob(
    name: string,
    schedule: string,
    taskDescription: string,
    targetAgentId?: string,
    options?: {
      timeoutSeconds?: number;
      wakeMode?: 'next-heartbeat' | 'now';
      runOnce?: boolean;
    },
  ): CronJob {
    const id = crypto.randomUUID();
    const isOneShot = options?.runOnce || false;

    const job: CronJob = {
      id,
      name,
      schedule,
      scheduleKind: isOneShot ? 'at' : 'cron',
      task: taskDescription,
      targetAgentId,
      systemPrompt: `You are an automated Cron Agent. Your goal is to execute the user's scheduled task efficiently.

RULES:
1. BATCHING: For multi-step independent tasks, ALWAYS use the 'batch' parameter in 'spawn_sub_agent' to run them in PARALLEL.
2. RESOURCEFULNESS: Assign appropriate models based on task complexity. Use efficient models for simple data processing and powerful models for complex reasoning.
3. CONTINUITY: If the task is part of a recurring workflow, check if a persistent agent session exists that you can resume or reuse.
`,
      enabled: true,
      timeoutSeconds: options?.timeoutSeconds,
      wakeMode: options?.wakeMode || 'next-heartbeat',
      deleteAfterRun: isOneShot,
      createdAt: Date.now(),
      state: {
        consecutiveErrors: 0,
      },
    };

    this.jobs.set(id, job);
    this.save();
    if (job.scheduleKind === 'cron') {
      this.schedule(job);
    }
    return job;
  }

  /**
   * Update an existing job.
   */
  updateJob(id: string, updates: Partial<Omit<CronJob, 'id' | 'createdAt'>>): CronJob {
    const job = this.jobs.get(id);
    if (!job) throw new Error(`Job ${id} not found`);

    const updated = { ...job, ...updates };
    this.jobs.set(id, updated);
    this.save();

    if (updates.schedule || updates.enabled !== undefined) {
      this.tasks.get(id)?.stop();
      const sessionId = `cron-${id}`;
      this.runtimeRegistry.abortHierarchy(sessionId);

      if (updated.enabled && updated.scheduleKind === 'cron') {
        this.schedule(updated);
      }
    }

    return updated;
  }

  /**
   * Pause a job (disable without removing).
   */
  pauseJob(id: string): CronJob {
    return this.updateJob(id, { enabled: false });
  }

  /**
   * Resume a paused job.
   */
  resumeJob(id: string): CronJob {
    const job = this.jobs.get(id);
    if (!job) throw new Error(`Job ${id} not found`);
    // Reset backoff state on explicit resume
    job.state.consecutiveErrors = 0;
    job.state.lastError = undefined;
    return this.updateJob(id, { enabled: true });
  }

  /**
   * Remove a job entirely.
   */
  removeJob(id: string) {
    this.tasks.get(id)?.stop();
    const sessionId = `cron-${id}`;
    this.runtimeRegistry.abortHierarchy(sessionId);

    this.tasks.delete(id);
    this.jobs.delete(id);
    this.save();
  }

  /**
   * Get a single job by ID.
   */
  getJob(id: string) {
    return this.jobs.get(id);
  }

  /**
   * Get all jobs.
   */
  getAllJobs(): CronJob[] {
    return Array.from(this.jobs.values());
  }

  /**
   * Get structured status of a job (for the cron_status tool).
   */
  getJobStatus(id: string): string {
    const job = this.jobs.get(id);
    if (!job) return `Job "${id}" not found.`;

    const s = job.state;
    const lines: string[] = [
      `**${job.name}** (${job.id})`,
      `Schedule: ${job.schedule} (${job.scheduleKind})`,
      `Enabled: ${job.enabled}`,
    ];

    if (s.runningAtMs) {
      const elapsed = Math.ceil((Date.now() - s.runningAtMs) / 1000);
      lines.push(`Status: RUNNING (${elapsed}s elapsed)`);
    } else if (s.lastStatus) {
      lines.push(`Last Status: ${s.lastStatus}`);
    } else {
      lines.push(`Status: NEVER RAN`);
    }

    if (s.lastRunAtMs) {
      lines.push(`Last Run: ${new Date(s.lastRunAtMs).toISOString()}`);
    }
    if (s.lastDurationMs !== undefined) {
      lines.push(`Duration: ${(s.lastDurationMs / 1000).toFixed(1)}s`);
    }
    if (s.consecutiveErrors > 0) {
      const backoffMs = errorBackoffMs(s.consecutiveErrors);
      const inBackoff = this.isInBackoff(job);
      lines.push(`Consecutive Errors: ${s.consecutiveErrors}`);
      lines.push(
        `Backoff: ${Math.ceil(backoffMs / 1000)}s ${inBackoff ? '(ACTIVE)' : '(cleared)'}`,
      );
    }
    if (s.lastError) {
      lines.push(`Last Error: ${s.lastError.slice(0, 200)}`);
    }

    return lines.join('\n');
  }
}
