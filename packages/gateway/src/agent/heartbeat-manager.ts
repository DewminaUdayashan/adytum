import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentRuntime } from './runtime.js';
import cron from 'node-cron';

const DEFAULT_PROMPT = `Read HEARTBEAT.md if it exists (workspace context). Follow it strictly. Do not infer or repeat old tasks from prior chats. If nothing needs attention, reply HEARTBEAT_OK.`;

export class HeartbeatManager {
  private task: cron.ScheduledTask | null = null;

  constructor(
    private agent: AgentRuntime,
    private workspacePath: string
  ) {}

  start(intervalMinutes: number) {
    this.schedule(intervalMinutes);
  }

  stop() {
    this.task?.stop();
    this.task = null;
  }

  schedule(minutes: number) {
    this.stop();
    const safeMinutes = Math.max(1, Math.floor(minutes));
    
    let cronExpr: string;
    if (safeMinutes < 60) {
      cronExpr = `*/${safeMinutes} * * * *`;
    } else {
      const hours = Math.floor(safeMinutes / 60);
      cronExpr = hours < 24 ? `0 */${hours} * * *` : `0 0 * * *`;
    }

    console.log(`[Heartbeat] Scheduling interval: ${safeMinutes}m -> ${cronExpr}`);
    
    this.task = cron.schedule(cronExpr, () => {
      this.run().catch(err => console.error('[Heartbeat] Error:', err));
    });
  }

  async run(): Promise<void> {
    const heartbeatFile = join(this.workspacePath, 'HEARTBEAT.md');
    let hasHeartbeatFile = false;
    let heartbeatContent = '';

    if (existsSync(heartbeatFile)) {
      heartbeatContent = readFileSync(heartbeatFile, 'utf-8').trim();
      // If file exists but is effectively empty (just headers/whitespace), skip
      const meaningfulContent = heartbeatContent.replace(/^#.*$/gm, '').trim();
      if (!meaningfulContent) {
        // Skip run to save tokens
        return;
      }
      hasHeartbeatFile = true;
    }

    // If no file and configured to skip? User said: 
    // "If the file is missing, the heartbeat still runs and the model decides what to do."
    // But then: "If HEARTBEAT.md exists but is effectively empty... OpenClaw skips."
    // I will follow: if empty/missing file -> assume default prompt behavior.

    const session = 'system-heartbeat';
    
    // Construct the actual prompt
    let prompt = DEFAULT_PROMPT;
    if (hasHeartbeatFile) {
        prompt += `\n\n[CONTEXT] HEARTBEAT.md content:\n${heartbeatContent}`;
    }

    try {
      await this.agent.run(prompt, session);
    } catch (error) {
      console.error('Heartbeat run failed:', error);
    }
  }
}
