/**
 * @file packages/gateway/src/domain/agents/agent-log-store.ts
 * @description Per-agent logs: thought process, actions, interactions (conversations).
 */

import { v4 as uuid } from 'uuid';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentLogEntry } from '@adytum/shared';

const LOGS_DIR = 'agent-logs';

export type AgentLogType = AgentLogEntry['type'];

/**
 * In-memory store of per-agent log entries, with optional file persistence.
 * Each agent has: thought (CoT), actions (tools/files), interactions (transcripts).
 */
export class AgentLogStore {
  private dataPath: string;
  private byAgent = new Map<string, AgentLogEntry[]>();
  private maxEntriesPerAgent = 500;

  constructor(dataPath: string) {
    this.dataPath = dataPath;
    this.load();
  }

  private dir(): string {
    const d = join(this.dataPath, 'hierarchy', LOGS_DIR);
    mkdirSync(d, { recursive: true });
    return d;
  }

  private agentFile(agentId: string): string {
    return join(this.dir(), `${agentId}.json`);
  }

  private load(): void {
    const d = this.dir();
    if (!existsSync(d)) return;
    try {
      const files = readdirSync(d);
      for (const f of files) {
        if (!f.endsWith('.json')) continue;
        const agentId = f.replace(/\.json$/, '');
        const path = join(d, f);
        const raw = readFileSync(path, 'utf-8');
        const entries = JSON.parse(raw) as AgentLogEntry[];
        this.byAgent.set(agentId, entries);
      }
    } catch {
      // ignore
    }
  }

  private saveAgent(agentId: string): void {
    const entries = this.byAgent.get(agentId);
    if (!entries) return;
    writeFileSync(this.agentFile(agentId), JSON.stringify(entries, null, 2), 'utf-8');
  }

  append(
    agentId: string,
    type: AgentLogType,
    content: string,
    payload?: Record<string, unknown>,
  ): AgentLogEntry {
    const entry: AgentLogEntry = {
      id: uuid(),
      agentId,
      timestamp: Date.now(),
      type,
      content,
      // model: payload?.model as string | undefined, // Removed as it's not in AgentLogEntry interface currently
      // payload, // Removed as it's not in AgentLogEntry interface currently or needs strict typing
      metadata: payload, // Map payload to metadata
    };
    let list = this.byAgent.get(agentId);
    if (!list) {
      list = [];
      this.byAgent.set(agentId, list);
    }
    list.push(entry);
    if (list.length > this.maxEntriesPerAgent) {
      list.splice(0, list.length - this.maxEntriesPerAgent);
    }
    this.saveAgent(agentId);
    return entry;
  }

  getByAgent(agentId: string): AgentLogEntry[] {
    return this.byAgent.get(agentId) ?? [];
  }

  getByAgentAndType(agentId: string, type: AgentLogType): AgentLogEntry[] {
    return this.getByAgent(agentId).filter((e) => e.type === type);
  }

  getThoughts(agentId: string): AgentLogEntry[] {
    return this.getByAgentAndType(agentId, 'thought');
  }

  getActions(agentId: string): AgentLogEntry[] {
    return this.getByAgentAndType(agentId, 'tool_call');
  }

  getInteractions(agentId: string): AgentLogEntry[] {
    return this.getByAgentAndType(agentId, 'message');
  }
}
