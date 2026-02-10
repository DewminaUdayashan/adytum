import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import cron from 'node-cron';
import { z } from 'zod';
import type { AgentRuntime } from './runtime.js';

export const CronJobSchema = z.object({
  id: z.string(),
  name: z.string(),
  schedule: z.string(), // Cron expression
  task: z.string(),     // Prompt/Instruction for the agent
  enabled: z.boolean().default(true),
  lastRun: z.number().optional(),
  createdAt: z.number(),
});

export type CronJob = z.infer<typeof CronJobSchema>;

export class CronManager {
  private jobs = new Map<string, CronJob>();
  private tasks = new Map<string, cron.ScheduledTask>();
  private filePath: string;

  constructor(
    private agent: AgentRuntime,
    private dataPath: string
  ) {
    this.filePath = join(this.dataPath, 'cron.json');
    this.load();
  }

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

  private save() {
    try {
      const data = Array.from(this.jobs.values());
      writeFileSync(this.filePath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('Failed to save cron jobs:', error);
    }
  }

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

        try {
            // We use a prefix ensuring it looks like it might be related to the user,
            // but effectively it's still a separate session. 
            // To make it visible in "Chat", the Chat UI must be looking at this session 
            // OR we need to broadcast the result to the main session.
            // For now, let's keep it isolated but we might need a "broadcast" mechanism later.
            // Wait, the user asked "The LLM must send me a message".
            // If the agent.run() calls tool "send_message" (hypothetical) or simply returns text,
            // that text goes to `cron-${job.id}`. The user isn't subscribed to that.
            
            // Temporary output: Log it. Real solution: allow agent to "push" to default channel.
            const sessionId = `cron-${job.id}`;
            const prompt = `[CRON JOB TRIGGERED: ${job.name}]\nRequired Action: ${job.task}\n\nExecute this action now. If the task involves sending a message to the user, just generate the response.`;
            
            await this.agent.run(prompt, sessionId);
        } catch (err) {
            console.error(`[Cron] Job ${job.name} failed:`, err);
        }
    });

    this.tasks.set(job.id, task);
  }

  // ── Public API ────────────────────────────────────────────────

  addJob(name: string, schedule: string, taskDescription: string): CronJob {
    const id = crypto.randomUUID();
    const job: CronJob = {
      id,
      name,
      schedule,
      task: taskDescription,
      enabled: true,
      createdAt: Date.now(),
    };

    this.jobs.set(id, job);
    this.save();
    this.schedule(job);
    return job;
  }

  updateJob(id: string, updates: Partial<Omit<CronJob, 'id' | 'createdAt'>>): CronJob {
    const job = this.jobs.get(id);
    if (!job) throw new Error(`Job ${id} not found`);

    const updated = { ...job, ...updates };
    this.jobs.set(id, updated);
    this.save();

    // Re-schedule if needed
    if (updates.schedule || updates.enabled !== undefined) {
        this.tasks.get(id)?.stop();
        if (updated.enabled) {
            this.schedule(updated);
        }
    }

    return updated;
  }

  removeJob(id: string) {
    this.tasks.get(id)?.stop();
    this.tasks.delete(id);
    this.jobs.delete(id);
    this.save();
  }

  getJob(id: string) {
    return this.jobs.get(id);
  }

  getAllJobs(): CronJob[] {
    return Array.from(this.jobs.values());
  }
}
