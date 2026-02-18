/**
 * @file packages/gateway/src/domain/agents/agent-registry.ts
 * @description Birth Protocol: agent metadata, lifecycle (Birth / Last Breath), and persistence.
 */

import { v4 as uuid } from 'uuid';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentMetadata, AgentTier, AgentLogEntry } from '@adytum/shared';

const AGENTS_FILENAME = 'agents.json';

export interface BirthParams {
  name: string;
  tier: AgentTier;
  parentId: string | null;
  avatarUrl?: string | null;
  role?: string;
  model?: string;
}

export interface AgentRecord extends AgentMetadata {
  /** In-memory only: current uptime start (null if deactivated). */
  _activeSince?: number | null;
  /** Persistent session ID for long-lived agents. */
  activeSessionId?: string;
}

/**
 * Registry of all agents (Prometheus + Tier 2 + Tier 3) with Birth Protocol metadata.
 * Persists to data/agents.json; supports Birth and Death (Last Breath).
 */
export class AgentRegistry {
  private dataPath: string;
  private agents = new Map<string, AgentRecord>();

  constructor(dataPath: string) {
    this.dataPath = dataPath;
    this.load();
  }

  private filePath(): string {
    const dir = join(this.dataPath, 'hierarchy');
    mkdirSync(dir, { recursive: true });
    return join(dir, AGENTS_FILENAME);
  }

  private load(): void {
    const path = this.filePath();
    if (!existsSync(path)) {
      this.agents.clear();
      return;
    }
    try {
      const raw = readFileSync(path, 'utf-8');
      const data = JSON.parse(raw) as { agents: AgentRecord[] };
      this.agents.clear();
      for (const a of data.agents || []) {
        this.agents.set(a.id, { ...a, modelIds: a.modelIds ?? [], _activeSince: null });
      }
    } catch {
      this.agents.clear();
    }
  }

  private save(): void {
    const path = this.filePath();
    const agents = Array.from(this.agents.values()).map((a) => {
      const { _activeSince, ...rest } = a;
      return rest;
    });
    writeFileSync(path, JSON.stringify({ agents }, null, 2), 'utf-8');
  }

  /** Birth: create a new agent with metadata. Returns the new AgentMetadata. */
  birth(params: BirthParams & { sessionId?: string }): AgentMetadata {
    const id = uuid();
    const now = Math.floor(Date.now() / 1000);
    const record: AgentRecord = {
      id,
      name: params.name,
      role: params.role,
      tier: params.tier,
      birthTime: now,
      lastBreath: null,
      avatar: params.avatarUrl ?? null,
      parentId: params.parentId,
      modelIds: params.model ? [params.model] : [], // Store assigned model
      _activeSince: now,
      activeSessionId: params.sessionId,
    };
    this.agents.set(id, record);
    this.save();
    return this.toMetadata(record);
  }

  /** Death (Last Breath): deactivate agent and set lastBreath timestamp. */
  lastBreath(agentId: string): AgentMetadata | null {
    const record = this.agents.get(agentId);
    if (!record) return null;
    const now = Math.floor(Date.now() / 1000);
    record.lastBreath = now;
    record._activeSince = null;
    this.agents.set(agentId, record);
    this.save();
    return this.toMetadata(record);
  }

  /** Get metadata by id. */
  get(agentId: string): AgentMetadata | null {
    const r = this.agents.get(agentId);
    return r ? this.toMetadata(r) : null;
  }

  /** Find active agent by name (case-insensitive) for reuse. */
  findActiveByName(name: string): AgentRecord | null {
    const normalized = name.trim().toLowerCase();
    for (const agent of this.agents.values()) {
      if (agent.lastBreath === null && agent.name.trim().toLowerCase() === normalized) {
        return agent;
      }
    }
    return null;
  }

  /** Get all agents (active and deactivated). */
  getAll(): AgentMetadata[] {
    return Array.from(this.agents.values()).map((a) => this.toMetadata(a));
  }

  /** Get only active agents (lastBreath === null). */
  getActive(): AgentMetadata[] {
    return this.getAll().filter((a) => a.lastBreath === null);
  }

  /** Get deactivated agents (Graveyard). */
  getGraveyard(): AgentMetadata[] {
    return this.getAll().filter((a) => a.lastBreath !== null);
  }

  /** Get children of a parent agent. */
  getChildren(parentId: string): AgentMetadata[] {
    return this.getAll().filter((a) => a.parentId === parentId);
  }

  /** Get active session ID for an agent (if running). */
  getActiveSessionId(agentId: string): string | undefined {
    return this.agents.get(agentId)?.activeSessionId;
  }

  /** Compute uptime in seconds (0 if deactivated). */
  getUptimeSeconds(agentId: string): number {
    const r = this.agents.get(agentId);
    if (!r) return 0;
    if (r.lastBreath != null) return 0;
    const since = r._activeSince ?? r.birthTime;
    return Math.floor(Date.now() / 1000) - since;
  }

  /** Set avatar URL (e.g. after DiceBear generation). */
  setAvatar(agentId: string, avatarUrl: string): void {
    const r = this.agents.get(agentId);
    if (!r) return;
    r.avatar = avatarUrl;
    this.agents.set(agentId, r);
    this.save();
  }

  /** Set allocated model IDs (Tier 1/2: max 5, Tier 3: max 3). */
  setModelIds(agentId: string, modelIds: string[]): void {
    const r = this.agents.get(agentId);
    if (!r) return;
    const max = r.tier === 3 ? 3 : 5;
    r.modelIds = modelIds.slice(0, max);
    this.agents.set(agentId, r);
    this.save();
  }

  /** Update agent name (e.g. nickname). */
  setName(agentId: string, name: string): void {
    const r = this.agents.get(agentId);
    if (!r) return;
    r.name = name.trim();
    this.agents.set(agentId, r);
    this.save();
  }

  private toMetadata(r: AgentRecord): AgentMetadata {
    return {
      id: r.id,
      name: r.name,
      tier: r.tier,
      birthTime: r.birthTime,
      lastBreath: r.lastBreath,
      avatar: r.avatar,
      parentId: r.parentId,
      modelIds: r.modelIds ?? [],
    };
  }
}
