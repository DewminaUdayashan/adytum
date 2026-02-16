/**
 * @file packages/gateway/src/api/controllers/agents.controller.ts
 * @description Hierarchical multi-agent API: registry, birth/death, logbook, agent logs.
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { singleton, inject } from 'tsyringe';
import type { AgentRegistry } from '../../domain/agents/agent-registry.js';
import type { LogbookService } from '../../application/services/logbook-service.js';
import type { AgentLogStore } from '../../domain/agents/agent-log-store.js';
import { ConfigService } from '../../infrastructure/config/config-service.js';
import type { AgentMetadata, HierarchySettings } from '@adytum/shared';

/** DiceBear avatar URL for an agent (deterministic from name). */
function dicebearAvatarUrl(name: string): string {
  const seed = encodeURIComponent(name || 'agent');
  return `https://api.dicebear.com/9.x/adventurer/svg?seed=${seed}`;
}

interface BirthBody {
  name: string;
  tier: 1 | 2 | 3;
  parentId: string | null;
  avatarUrl?: string | null;
}

@singleton()
export class AgentsController {
  constructor(
    @inject('AgentRegistry') private registry: AgentRegistry,
    @inject('LogbookService') private logbook: LogbookService,
    @inject('AgentLogStore') private agentLogs: AgentLogStore,
    @inject(ConfigService) private config: ConfigService,
  ) {}

  /** GET /api/agents — all agents (active + graveyard). */
  async list(_req: FastifyRequest, reply: FastifyReply) {
    const agents = this.registry.getAll().map((a) => ({
      ...a,
      uptimeSeconds: this.registry.getUptimeSeconds(a.id),
    }));
    return reply.send({ agents });
  }

  /** GET /api/agents/hierarchy — tree structure for UI (active agents only; deactivated appear only in graveyard). */
  async hierarchy(_req: FastifyRequest, reply: FastifyReply) {
    const active = this.registry.getActive();
    const build = (parentId: string | null): any[] =>
      active
        .filter((a) => a.parentId === parentId)
        .map((a) => ({
          ...a,
          uptimeSeconds: this.registry.getUptimeSeconds(a.id),
          children: build(a.id),
        }));
    const root = active.find((a) => a.tier === 1);
    const tree =
      root != null
        ? [{ ...root, uptimeSeconds: this.registry.getUptimeSeconds(root.id), children: build(root.id) }]
        : build(null);
    return reply.send({ hierarchy: tree });
  }

  /** GET /api/agents/graveyard — deactivated agents. */
  async graveyard(_req: FastifyRequest, reply: FastifyReply) {
    const agents = this.registry.getGraveyard();
    return reply.send({ agents });
  }

  /** GET /api/agents/:id — one agent with uptime. */
  async get(req: FastifyRequest, reply: FastifyReply) {
    const { id } = (req.params as { id: string });
    const agent = this.registry.get(id);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    return reply.send({
      ...agent,
      uptimeSeconds: this.registry.getUptimeSeconds(id),
    });
  }

  /** POST /api/agents/birth — create new agent (Birth Protocol). */
  async birth(req: FastifyRequest, reply: FastifyReply) {
    const body = req.body as BirthBody;
    if (!body?.name || body.tier == null) {
      return reply.status(400).send({ error: 'name and tier required' });
    }
    const tier = Math.min(3, Math.max(1, Number(body.tier) || body.tier)) as 1 | 2 | 3;
    const parentId =
      body.parentId != null && String(body.parentId).trim() ? String(body.parentId).trim() : null;
    const settings = (this.config.getFullConfig() as { hierarchy?: { maxTier2Agents?: number; maxTier3Agents?: number } }).hierarchy;
    if (tier === 2 && settings) {
      const activeT2 = this.registry.getActive().filter((a) => a.tier === 2).length;
      if (activeT2 >= (settings.maxTier2Agents ?? 10)) {
        return reply.status(429).send({ error: 'Max Tier 2 agents reached' });
      }
    }
    if (tier === 3 && settings) {
      const activeT3 = this.registry.getActive().filter((a) => a.tier === 3).length;
      if (activeT3 >= (settings.maxTier3Agents ?? 30)) {
        return reply.status(429).send({ error: 'Max Tier 3 agents reached' });
      }
    }
    const agent = this.registry.birth({
      name: String(body.name).trim(),
      tier,
      parentId,
      avatarUrl: body.avatarUrl ?? null,
    });

    const hierarchyConfig = (this.config.getFullConfig() as { hierarchy?: { avatarGenerationEnabled?: boolean } }).hierarchy;
    if (hierarchyConfig?.avatarGenerationEnabled !== false && !body.avatarUrl) {
      this.registry.setAvatar(agent.id, dicebearAvatarUrl(agent.name));
    }

    this.logbook.append({
      timestamp: Date.now(),
      agentId: agent.id,
      agentName: agent.name,
      tier: agent.tier,
      event: 'birth',
      detail: `Agent ${agent.name} (Tier ${agent.tier}) created`,
    });
    return reply.send({
      ...agent,
      uptimeSeconds: this.registry.getUptimeSeconds(agent.id),
    });
  }

  /** PATCH /api/agents/:id — update agent (modelIds, name). */
  async update(req: FastifyRequest, reply: FastifyReply) {
    const { id } = req.params as { id: string };
    const body = (req.body || {}) as { modelIds?: string[]; name?: string };
    const agent = this.registry.get(id);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });

    if (Array.isArray(body.modelIds)) {
      const max = agent.tier === 3 ? 3 : 5;
      this.registry.setModelIds(id, body.modelIds.slice(0, max));
    }
    if (typeof body.name === 'string' && body.name.trim()) {
      this.registry.setName(id, body.name.trim());
    }

    const updated = this.registry.get(id)!;
    return reply.send({
      ...updated,
      uptimeSeconds: this.registry.getUptimeSeconds(id),
    });
  }

  /** POST /api/agents/:id/death — deactivate agent (Last Breath). */
  async death(req: FastifyRequest, reply: FastifyReply) {
    const { id } = req.params as { id: string };
    const agent = this.registry.lastBreath(id);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    this.logbook.append({
      timestamp: Date.now(),
      agentId: agent.id,
      agentName: agent.name,
      tier: agent.tier,
      event: 'last_breath',
      detail: `Agent ${agent.name} deactivated`,
    });
    return reply.send(agent);
  }

  /** POST /api/agents/deactivate-all-subagents — Last Breath for all Tier 2 and Tier 3 agents (keeps Prometheus). */
  async deactivateAllSubagents(_req: FastifyRequest, reply: FastifyReply) {
    const active = this.registry.getActive();
    const subAgents = active.filter((a) => a.tier === 2 || a.tier === 3);
    const ids: string[] = [];
    for (const a of subAgents) {
      const deactivated = this.registry.lastBreath(a.id);
      if (deactivated) ids.push(deactivated.id);
      this.logbook.append({
        timestamp: Date.now(),
        agentId: a.id,
        agentName: a.name,
        tier: a.tier,
        event: 'last_breath',
        detail: `Agent ${a.name} deactivated (deactivate-all)`,
      });
    }
    return reply.send({ deactivated: ids.length, ids });
  }

  /** GET /api/agents/logbook — full LOGBOOK.md content. */
  async getLogbook(_req: FastifyRequest, reply: FastifyReply) {
    const content = this.logbook.read();
    return reply.send({ content });
  }

  /** GET /api/agents/:id/logs — agent's thought/action/interaction logs. */
  async getAgentLogs(req: FastifyRequest, reply: FastifyReply) {
    const { id } = req.params as { id: string };
    const { type } = (req.query as { type?: string });
    if (!this.registry.get(id)) return reply.status(404).send({ error: 'Agent not found' });
    const entries = type
      ? this.agentLogs.getByAgentAndType(id, type as 'thought' | 'action' | 'interaction')
      : this.agentLogs.getByAgent(id);
    return reply.send({ entries });
  }

  /** GET /api/agents/settings — hierarchy global settings. */
  async getSettings(_req: FastifyRequest, reply: FastifyReply) {
    const config = this.config.getFullConfig();
    const hierarchy = (config as any).hierarchy as HierarchySettings | undefined;
    const settings: HierarchySettings = {
      avatarGenerationEnabled: hierarchy?.avatarGenerationEnabled ?? true,
      maxTier2Agents: hierarchy?.maxTier2Agents ?? 10,
      maxTier3Agents: hierarchy?.maxTier3Agents ?? 30,
      defaultRetryLimit: hierarchy?.defaultRetryLimit ?? 3,
      modelPriorityTier1And2: hierarchy?.modelPriorityTier1And2 ?? [],
      modelPriorityTier3: hierarchy?.modelPriorityTier3 ?? [],
    };
    return reply.send(settings);
  }

  /** PUT /api/agents/settings — update hierarchy settings (persisted in config). */
  async updateSettings(req: FastifyRequest, reply: FastifyReply) {
    const body = (req.body || {}) as Partial<HierarchySettings>;
    const config = this.config.getFullConfig();
    const hierarchy = (config as { hierarchy?: HierarchySettings }).hierarchy ?? ({} as HierarchySettings);
    const next: HierarchySettings = {
      avatarGenerationEnabled: body.avatarGenerationEnabled ?? hierarchy.avatarGenerationEnabled ?? true,
      maxTier2Agents: body.maxTier2Agents ?? hierarchy.maxTier2Agents ?? 10,
      maxTier3Agents: body.maxTier3Agents ?? hierarchy.maxTier3Agents ?? 30,
      defaultRetryLimit: body.defaultRetryLimit ?? hierarchy.defaultRetryLimit ?? 3,
      modelPriorityTier1And2: body.modelPriorityTier1And2 ?? hierarchy.modelPriorityTier1And2 ?? [],
      modelPriorityTier3: body.modelPriorityTier3 ?? hierarchy.modelPriorityTier3 ?? [],
    };
    this.config.set({ hierarchy: next } as Partial<import('@adytum/shared').AdytumConfig>);
    return reply.send(next);
  }
}
