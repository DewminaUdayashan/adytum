/**
 * @file packages/gateway/src/domain/logic/swarm-sweeper.ts
 * @description Periodic reaper that terminates stale or timed-out agents.
 *              Inspired by OpenClaw's registry sweeper.
 */

import { singleton, inject } from 'tsyringe';
import { SwarmManager } from './swarm-manager.js';
import { Logger } from '../../logger.js';

const SWEEP_INTERVAL_MS = 60_000; // 1 minute
const STALE_SPAWNING_MS = 10 * 60_000; // 10 minutes
const DEFAULT_IDLE_TIMEOUT_MS = 60 * 60_000; // 1 hour

@singleton()
export class SwarmSweeper {
  private interval: NodeJS.Timeout | null = null;

  constructor(
    @inject(SwarmManager) private swarmManager: SwarmManager,
    @inject(Logger) private logger: Logger,
  ) {}

  /**
   * Starts the periodic sweep.
   */
  public start(): void {
    if (this.interval) return;
    this.logger.info('[SwarmSweeper] Starting stale agent reaper...');
    this.interval = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
  }

  /**
   * Stops the periodic sweep.
   */
  public stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  /**
   * Performs the sweep across all active agents.
   */
  private sweep(): void {
    const agents = this.swarmManager.getAllAgents();
    const now = Date.now();

    for (const agent of agents) {
      // Don't kill the Architect
      if (agent.type === 'architect') continue;

      let shouldTerminate = false;
      let reason = '';

      // 1. Check for agents stuck in spawning
      if (agent.status === 'spawning') {
        const age = now - agent.createdAt;
        if (age > STALE_SPAWNING_MS) {
          shouldTerminate = true;
          reason = `Stuck in spawning for ${Math.floor(age / 1000)}s`;
        }
      }

      // 2. Check for inactivity timeout
      if (!shouldTerminate) {
        const lastActivity = agent.lastActivityAt || agent.createdAt;
        const idleTime = now - lastActivity;
        const timeout = agent.timeoutMs || DEFAULT_IDLE_TIMEOUT_MS;

        if (idleTime > timeout) {
          shouldTerminate = true;
          reason = `Inactivity timeout: idle for ${Math.floor(idleTime / 1000)}s (limit: ${Math.floor(timeout / 1000)}s)`;
        }
      }

      if (shouldTerminate) {
        this.logger.warn(
          `[SwarmSweeper] Terminating stale agent ${agent.name} (${agent.id}): ${reason}`,
        );
        this.swarmManager.terminateAgent(agent.id, `Reaped by SwarmSweeper: ${reason}`);
        this.swarmManager.notifyFailure(agent.id, `Timeout: ${reason}`);
      }
    }
  }
}
