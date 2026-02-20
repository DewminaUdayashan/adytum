/**
 * @file packages/shared/src/types/agent.ts
 * @description Defines the core data models for Adytum Agents.
 */

export type AgentStatus = 'spawning' | 'working' | 'idle' | 'reviewing' | 'dead' | 'asleep';
export type AgentType = 'architect' | 'manager' | 'worker';

export interface AdytumAgent {
  id: string; // UUID
  parentId: string | null; // null for the Main Architect
  name: string; // e.g., "Cosmic Weaver", "Data Hunter"
  role: string; // e.g., "Backend Security Specialist"
  avatarUrl: string; // https://api.dicebear.com/9.x/bottts/svg?seed=${id}
  status: AgentStatus;
  type: AgentType;
  isRecurring: boolean; // If true, goes to sleep instead of Graveyard
  createdAt: number; // Timestamp
  terminatedAt?: number; // Timestamp

  // The Context
  systemPrompt?: string; // The "Soul" (optional mostly for transmission efficiency)
  tools: string[]; // Allowed tools

  // Metadata for the UI/Tree
  metadata?: Record<string, any>;
}

export interface AgentLogEntry {
  id: string;
  agentId: string;
  timestamp: number;
  type: 'thought' | 'tool_call' | 'tool_result' | 'message';
  content: string;
  metadata?: any;
}

// SwarmEvents moved to ../events/index.ts
