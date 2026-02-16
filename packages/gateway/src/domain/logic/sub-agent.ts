/**
 * @file packages/gateway/src/domain/logic/sub-agent.ts
 * @description Contains domain logic and core business behavior.
 */

import { v4 as uuid } from 'uuid';
import { AgentRuntime, type AgentRuntimeConfig, type AgentTurnResult } from './agent-runtime.js';
import { ContextManager } from './context-manager.js';
import { auditLogger } from '../../security/audit-logger.js';
import type { RuntimeRegistry } from '../agents/runtime-registry.js';
import { EventEmitter } from 'node:events';

export interface SubAgentConfig extends AgentRuntimeConfig {
  parentTraceId: string;
  parentSessionId: string;
  goal: string;
}

/**
 * Sub-Agent Spawner — creates disposable micro-agents for isolated subtasks.
 * Each sub-agent gets its own session, context, and tool access.
 * Results are summarized and returned to the parent agent.
 */
export class SubAgentSpawner extends EventEmitter {
  private config: AgentRuntimeConfig;
  private runtimeRegistry: RuntimeRegistry;

  constructor(config: AgentRuntimeConfig, runtimeRegistry: RuntimeRegistry) {
    super();
    this.config = config;
    this.runtimeRegistry = runtimeRegistry;
  }

  /**
   * Spawn a sub-agent to handle an isolated subtask.
   * Returns the summarized result.
   */
  async spawn(params: { parentTraceId: string; parentSessionId: string; goal: string; tier?: number }): Promise<{
    result: string;
    traceId: string;
    toolCalls: number;
  }> {
    const childSessionId = uuid();
    const tier = params.tier ?? 3; // Default to Tier 3 if not specified

    // Log the spawn event
    auditLogger.logSubAgentSpawn(params.parentTraceId, childSessionId, params.goal);

    this.emit('sub_agent_spawn', {
      parentTraceId: params.parentTraceId,
      childSessionId,
      goal: params.goal,
    });

    // Create a new runtime for the sub-agent
    const childRuntime = new AgentRuntime({
      ...this.config,
      agentName: `${this.config.agentName} (Tier ${tier})`,
      tier: tier, 
    });

    // Register this sub-agent session as a child of the parent session context
    // This enables the "kill button" on the parent to bubble down here
    this.runtimeRegistry.register(childSessionId, childRuntime, params.parentSessionId);

    // Forward stream events with sub-agent prefix
    childRuntime.on('stream', (event) => {
      this.emit('stream', {
        ...event,
        sessionId: params.parentSessionId,
        metadata: {
          ...(event.metadata || {}),
          isSubAgent: true,
          childSessionId,
        },
      });
    });

    // Run the sub-agent
    const turnResult = await childRuntime.run(params.goal, childSessionId);

    this.emit('sub_agent_complete', {
      parentTraceId: params.parentTraceId,
      childSessionId,
      result: turnResult.response.slice(0, 500),
    });

    // Cleanup: unregister (AgentRuntime.run does self-unregister, but handling here for safety if run() fails early)
    // Actually AgentRuntime.run() handles unregister logic in finally/cleanup block, so we might be redundant, 
    // but explicit ensuring is good.
    // However, since AgentRuntime calls unregister(childSessionId), we probably don't need to do it here. 
    // BUT we do need to remove it from the parent's hierarchy set in the registry.
    // The unregister() method in registry handles both.

    return {
      result: turnResult.response,
      traceId: turnResult.trace.id,
      toolCalls: turnResult.toolCalls.length,
    };
  }
}
