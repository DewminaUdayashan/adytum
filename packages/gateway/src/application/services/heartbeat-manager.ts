import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentRuntime } from '../../domain/logic/agent-runtime.js';
import cron from 'node-cron';

const DEFAULT_PROMPT = `
You are the Heartbeat Manager.
Your task is to check the file "HEARTBEAT.md" and execute any pending tasks.
1. Read "HEARTBEAT.md" (if it exists).
2. If it contains tasks, execute them using available tools.
3. If a task is done, update "HEARTBEAT.md" to mark it as done or remove it.
4. If the file is empty or all tasks are done, reply exactly "HEARTBEAT_OK".
5. Do NOT chat. Do NOT act on previous conversation history. Only act on "HEARTBEAT.md".
`;

export class HeartbeatManager {
  private task: cron.ScheduledTask | null = null;

  constructor(
    private agent: AgentRuntime,
    private workspacePath: string,
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
      this.run().catch((err) => console.error('[Heartbeat] Error:', err));
    });
  }

  async run(): Promise<void> {
    const heartbeatFile = join(this.workspacePath, 'HEARTBEAT.md');
    let hasHeartbeatFile = false;
    let heartbeatContent = '';

    if (existsSync(heartbeatFile)) {
      heartbeatContent = readFileSync(heartbeatFile, 'utf-8').trim();
      const meaningfulContent = heartbeatContent.replace(/^#.*$/gm, '').trim();
      if (!meaningfulContent) {
        // Skip run to save tokens if nothing to do
        return;
      }
      hasHeartbeatFile = true;
    }

    const session = 'system-heartbeat';

    // Construct the actual prompt
    let prompt = DEFAULT_PROMPT;
    if (hasHeartbeatFile) {
      prompt += `\n\n[CONTEXT] HEARTBEAT.md content:\n${heartbeatContent}`;
    }

    try {
      const result = await this.agent.run(prompt, session);

      // Log simple status to console instead of full chat
      if (result.response.includes('HEARTBEAT_OK')) {
        console.log('[Heartbeat] Status: OK');
      } else {
        console.log(
          '[Heartbeat] Activity:',
          result.response.slice(0, 100) + (result.response.length > 100 ? '...' : ''),
        );
      }
    } catch (error) {
      console.error('Heartbeat run failed:', error);
    }
  }
}
