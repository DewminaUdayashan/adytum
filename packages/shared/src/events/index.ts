/**
 * @file packages/shared/src/events/index.ts
 * @description Core event bus interfaces and types for Adytum's reactive architecture.
 */

// Core Event Interface
export interface AdytumEvent<T = any> {
  id: string;
  type: string;
  payload: T;
  source: string;
  timestamp: number;
  correlationId?: string;
  workspaceId?: string;
}

// Memory Events
export const MemoryEvents = {
  CREATED: 'memory:created',
  UPDATED: 'memory:updated',
  DELETED: 'memory:deleted',
} as const;

// Knowledge Graph Events
export const GraphEvents = {
  INDEXING_STARTED: 'graph:indexing_started',
  INDEXING_COMPLETED: 'graph:indexing_completed',
  NODE_UPDATED: 'graph:node_updated',
} as const;

// Agent Events
export const AgentEvents = {
  THOUGHT: 'agent:thought',
  TOOL_CALL: 'agent:tool_call',
  TOOL_RESULT: 'agent:tool_result',
  ERROR: 'agent:error',
} as const;

// System Events
export const SystemEvents = {
  READY: 'system:ready',
  CONFIG_UPDATED: 'system:config_updated',
} as const;

export type EventType = 
  | typeof MemoryEvents[keyof typeof MemoryEvents]
  | typeof GraphEvents[keyof typeof GraphEvents]
  | typeof AgentEvents[keyof typeof AgentEvents]
  | typeof SystemEvents[keyof typeof SystemEvents];
