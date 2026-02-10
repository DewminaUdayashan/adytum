import { v4 as uuid } from 'uuid';
import { AgentRuntime, type AgentRuntimeConfig, type AgentTurnResult } from './runtime.js';
import { ContextManager } from './context-manager.js';
import { auditLogger } from '../security/audit-logger.js';
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

  constructor(config: AgentRuntimeConfig) {
    super();
    this.config = config;
  }

  /**
   * Spawn a sub-agent to handle an isolated subtask.
   * Returns the summarized result.
   */
  async spawn(params: {
    parentTraceId: string;
    parentSessionId: string;
    goal: string;
  }): Promise<{
    result: string;
    traceId: string;
    toolCalls: number;
  }> {
    const childSessionId = uuid();

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
      agentName: `${this.config.agentName} (sub-agent)`,
    });

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

    return {
      result: turnResult.response,
      traceId: turnResult.trace.id,
      toolCalls: turnResult.toolCalls.length,
    };
  }
}
