import { logger } from '../../logger.js';
/**
 * @file packages/gateway/src/application/services/heartbeat-manager.ts
 * @description Implements application-level service logic and coordination.
 */

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
4. Always reply in this exact format:
   STATUS: <idle|updated|error>
   SUMMARY: <one short sentence>
5. Do NOT chat. Do NOT act on previous conversation history. Only act on "HEARTBEAT.md".
`;

/**
 * Encapsulates heartbeat manager behavior.
 */
export class HeartbeatManager {
  private task: cron.ScheduledTask | null = null;
  private isRunning: boolean = false;

  constructor(
    private agent: AgentRuntime,
    private workspacePath: string,
  ) {}

  /**
   * Triggers an immediate heartbeat run if not already running.
   */
  async runNow(): Promise<void> {
    if (this.isRunning) {
      logger.debug('[Heartbeat] Already running, skipping runNow trigger.');
      return;
    }
    logger.debug('[Heartbeat] Manual trigger: runNow');
    return this.run();
  }

  /**
   * Executes start.
   * @param intervalMinutes - Interval minutes.
   */
  start(intervalMinutes: number) {
    this.schedule(intervalMinutes);
  }

  /**
   * Executes stop.
   */
  stop() {
    this.task?.stop();
    this.task = null;
  }

  /**
   * Executes schedule.
   * @param minutes - Minutes.
   */
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

    logger.debug(`[Heartbeat] Scheduling interval: ${safeMinutes}m -> ${cronExpr}`);

    this.task = cron.schedule(cronExpr, () => {
      this.run().catch((err) => console.error('[Heartbeat] Error:', err));
    });
  }

  /**
   * Executes run.
   */
  async run(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      const heartbeatFile = join(this.workspacePath, 'HEARTBEAT.md');
      let hasHeartbeatFile = false;
      let heartbeatContent = '';

      if (existsSync(heartbeatFile)) {
        heartbeatContent = readFileSync(heartbeatFile, 'utf-8').trim();
        const meaningfulContent = heartbeatContent.replace(/^#.*$/gm, '').trim();
        if (!meaningfulContent) {
          logger.debug('[Heartbeat] Status: idle | Summary: HEARTBEAT.md has no actionable tasks.');
          return;
        }
        hasHeartbeatFile = true;
      } else {
        logger.debug('[Heartbeat] Status: idle | Summary: HEARTBEAT.md file not found.');
        return;
      }

      const session = 'system-heartbeat';

      // Construct the actual prompt
      let prompt = DEFAULT_PROMPT;
      if (hasHeartbeatFile) {
        prompt += `\n\n[CONTEXT] HEARTBEAT.md content:\n${heartbeatContent}`;
      }

      const result = await this.agent.run(prompt, session);
      const parsedStatus = result.response.match(/^\s*STATUS:\s*(.+)$/im)?.[1]?.trim();
      const parsedSummary = result.response.match(/^\s*SUMMARY:\s*(.+)$/im)?.[1]?.trim();

      if (parsedStatus || parsedSummary) {
        logger.debug(
          `[Heartbeat] Status: ${parsedStatus ?? 'unknown'} | Summary: ${parsedSummary ?? 'No summary provided.'}`,
        );
      } else {
        // Backward-compatible fallback if the model does not follow the structured format.
        logger.debug(
          '[Heartbeat] Activity:',
          result.response.slice(0, 160) + (result.response.length > 160 ? '...' : ''),
        );
      }
    } catch (error) {
      console.error('Heartbeat run failed:', error);
    } finally {
      this.isRunning = false;
    }
  }
}
