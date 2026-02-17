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
import type { AgentRegistry } from '../agents/agent-registry.js';
import type { LogbookService } from '../../application/services/logbook-service.js';
import type { AgentLogStore } from '../agents/agent-log-store.js';
import { createSpawnAgentTool, type GenerateAvatarFn } from '../../tools/spawn-agent.js';
import { ToolRegistry } from '../../tools/registry.js';

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
  private agentRegistry: AgentRegistry;
  private logbookService: LogbookService;
  private agentLogStore: AgentLogStore;
  private avatarOptions?: { generateAvatar?: GenerateAvatarFn; avatarEnabled?: boolean };

  constructor(
    config: AgentRuntimeConfig,
    runtimeRegistry: RuntimeRegistry,
    agentRegistry: AgentRegistry,
    logbookService: LogbookService,
    agentLogStore: AgentLogStore,
    avatarOptions?: { generateAvatar?: GenerateAvatarFn; avatarEnabled?: boolean },
  ) {
    super();
    this.config = config;
    this.runtimeRegistry = runtimeRegistry;
    this.agentRegistry = agentRegistry;
    this.logbookService = logbookService;
    this.agentLogStore = agentLogStore;
    this.avatarOptions = avatarOptions;
  }

  /**
   * Spawn a sub-agent to handle an isolated subtask.
   * Returns the summarized result.
   */
  async spawn(params: {
    parentTraceId: string;
    parentSessionId: string;
    goal: string;
    tier?: number;
    sessionId?: string;
    agentId?: string;
  }): Promise<{
    result: string;
    traceId: string;
    toolCalls: number;
  }> {
    const childSessionId = params.sessionId ?? uuid();
    const tier = params.tier ?? 3; // Default to Tier 3 if not specified
    // agentId is the ID of the agent being spawned (if known/persisted) to setup tools correctly
    const childAgentId = params.agentId;

    // Log the spawn event
    auditLogger.logSubAgentSpawn(params.parentTraceId, childSessionId, params.goal);

    this.emit('sub_agent_spawn', {
      parentTraceId: params.parentTraceId,
      childSessionId,
      goal: params.goal,
    });

    // Create specialized tool registry for this child
    // This allows the child to have a "spawn_sub_agent" tool that knows WHO the child is (defaults parentId to child)
    const childToolRegistry = new ToolRegistry();

    // Copy parent tools
    for (const tool of this.config.toolRegistry.getAll()) {
      childToolRegistry.register(tool);
    }

    // Override spawn_sub_agent if childAgentId is known
    // This ensures that if the Child spawns a Sub-Child, the parentId defaults to Child, not Root.
    if (childAgentId) {
      const specializedSpawnTool = createSpawnAgentTool(
        this.agentRegistry,
        this.logbookService,
        this.agentLogStore,
        this,
        childAgentId, // <--- THE KEY FIX: Default parent ID is THIS agent, not Prometheus
        this.avatarOptions, // <--- FIX: Pass avatar options to specialized tool
      );
      childToolRegistry.register(specializedSpawnTool);
    }

    // Create a new runtime for the sub-agent
    const childRuntime = new AgentRuntime({
      ...this.config,
      toolRegistry: childToolRegistry, // Use specialized registry
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
