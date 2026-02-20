/**
 * @file packages/gateway/src/api/controllers/agents.controller.ts
 * @description Hierarchical multi-agent API: registry, birth/death, logbook, agent logs.
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { singleton, inject } from 'tsyringe';
import { Logger } from '../../logger.js';
import type { AgentRegistry } from '../../domain/agents/agent-registry.js';
import type { LogbookService } from '../../application/services/logbook-service.js';
import type { AgentLogStore } from '../../infrastructure/repositories/agent-log-store.js';
// import type { SubAgentSpawner } from '../../domain/logic/sub-agent-spawner.js';
import { loadConfig, saveConfig } from '../../config.js';
import type { AgentMetadata, HierarchySettings } from '@adytum/shared';
import { SwarmManager } from '../../domain/logic/swarm-manager.js';

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
    @inject(Logger) private logger: Logger,
    @inject('LogbookService') private logbook: LogbookService,
    @inject('AgentRegistry') private agentRegistry: AgentRegistry,
    @inject(SwarmManager) private swarmManager: SwarmManager,
    @inject('AgentLogStore') private agentLogs: AgentLogStore,
  ) {}

  /** GET /api/agents — all agents (active + graveyard). */
  async list(_req: FastifyRequest, reply: FastifyReply) {
    const active = this.swarmManager.getAllAgents();
    const graveyard = this.swarmManager.getGraveyard();
    const agents = [...active, ...graveyard].map((a) => ({
      ...a,
      uptimeSeconds: this.agentRegistry.getUptimeSeconds(a.id),
    }));
    return reply.send({ agents });
  }

  /** GET /api/agents/hierarchy — tree structure for UI (active agents only; deactivated appear only in graveyard). */
  async hierarchy(_req: FastifyRequest, reply: FastifyReply) {
    const hierarchy = this.swarmManager.getHierarchy().map((a) => ({
      ...a,
      uptimeSeconds: this.agentRegistry.getUptimeSeconds(a.id),
      children: [], // SwarmManager v1 is flat list mostly, logic for tree building can happen here if needed via parentId
    }));
    return reply.send({ hierarchy });
  }

  /** GET /api/agents/graveyard — deactivated agents. */
  async graveyard(_req: FastifyRequest, reply: FastifyReply) {
    const agents = this.swarmManager.getGraveyard();
    return reply.send({ agents });
  }

  /** GET /api/agents/:id — one agent with uptime. */
  async get(req: FastifyRequest, reply: FastifyReply) {
    const { id } = req.params as { id: string };
    const agent = this.swarmManager.getAgent(id);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    return reply.send({
      ...agent,
      uptimeSeconds: this.agentRegistry.getUptimeSeconds(id),
    });
  }

  /** POST /api/agents/birth — create new agent (Only Tier 1 now supported). */
  async birth(req: FastifyRequest, reply: FastifyReply) {
    const body = req.body as BirthBody;
    if (!body?.name) {
      return reply.status(400).send({ error: 'name required' });
    }

    // Use SwarmManager to spawn
    const agent = this.swarmManager.createAgent({
      parentId: body.parentId || null,
      role: (body as any).role || 'Assistant',
      mission: (body as any).mission || 'Manual Agent',
      tier: body.tier,
      mode: (body as any).mode || 'reactive',
      cronSchedule: (body as any).cronSchedule,
    });

    // Override name if needed
    if (body.name) {
      agent.name = body.name;
    }
    if (body.avatarUrl) {
      agent.avatarUrl = body.avatarUrl;
    }

    this.logbook.append({
      timestamp: Date.now(),
      event: 'birth',
      detail: `Agent ${agent.name} (Tier ${agent.metadata?.tier}) born via API.`,
    });

    return reply.send({
      ...agent,
      uptimeSeconds: this.agentRegistry.getUptimeSeconds(agent.id),
    });
  }

  /** PATCH /api/agents/:id — update agent (modelIds, name). */
  async update(req: FastifyRequest, reply: FastifyReply) {
    const { id } = req.params as { id: string };
    const body = (req.body || {}) as { modelIds?: string[]; name?: string };
    const agent = this.swarmManager.getAgent(id);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });

    // SwarmManager agents are in-memory objects, so we can modify them.
    // In a real DB, use a service method.
    // Models are not really used in Swarm v1 per agent yet (it's global Router), but for compatibility:
    // if (Array.isArray(body.modelIds)) { ... }

    if (typeof body.name === 'string' && body.name.trim()) {
      agent.name = body.name.trim();
    }

    return reply.send({
      ...agent,
      uptimeSeconds: this.agentRegistry.getUptimeSeconds(id),
    });
  }

  /** POST /api/agents/:id/death — deactivate agent (Last Breath). */
  async death(req: FastifyRequest, reply: FastifyReply) {
    const { id } = req.params as { id: string };
    const agent = this.agentRegistry.lastBreath(id);
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
  /** POST /api/agents/deactivate-all-subagents — Last Breath for all Tier 2 and Tier 3 agents (keeps Prometheus). */
  async deactivateAllSubagents(_req: FastifyRequest, reply: FastifyReply) {
    // No-op in single agent mode
    return reply.send({ deactivated: 0, ids: [] });
  }

  /** GET /api/agents/logbook — full LOGBOOK.md content. */
  async getLogbook(_req: FastifyRequest, reply: FastifyReply) {
    const content = this.logbook.read();
    return reply.send({ content });
  }

  /** GET /api/agents/:id/logs — agent's thought/action/interaction logs. */
  async getAgentLogs(req: FastifyRequest, reply: FastifyReply) {
    const { id } = req.params as { id: string };
    const { type } = req.query as { type?: string };
    if (!this.agentRegistry.get(id)) return reply.status(404).send({ error: 'Agent not found' });
    const entries = type
      ? await this.agentLogs.getByAgentAndType(id, type as 'thought' | 'action' | 'interaction')
      : await this.agentLogs.getByAgent(id);
    return reply.send({ entries });
  }

  /** GET /api/agents/settings — hierarchy global settings. */
  async getSettings(_req: FastifyRequest, reply: FastifyReply) {
    const config = loadConfig();
    const hierarchy = (config as any).hierarchy as HierarchySettings | undefined;
    const settings: HierarchySettings = {
      enabled: hierarchy?.enabled ?? true,
      avatarGenerationEnabled: hierarchy?.avatarGenerationEnabled ?? true,
      maxTier2Agents: hierarchy?.maxTier2Agents ?? 3,
      maxTier3Agents: hierarchy?.maxTier3Agents ?? 10,
      defaultRetryLimit: hierarchy?.defaultRetryLimit ?? 3,
      modelPriorityTier1And2: hierarchy?.modelPriorityTier1And2 ?? [],
      modelPriorityTier3: hierarchy?.modelPriorityTier3 ?? [],
    };
    return reply.send(settings);
  }

  /** PUT /api/agents/settings — update hierarchy settings (persisted in config). */
  async updateSettings(req: FastifyRequest, reply: FastifyReply) {
    const body = (req.body || {}) as Partial<HierarchySettings>;
    const config = loadConfig();
    const hierarchy =
      (config as { hierarchy?: HierarchySettings }).hierarchy ?? ({} as HierarchySettings);
    const next: HierarchySettings = {
      enabled: body.enabled ?? hierarchy.enabled ?? true,
      avatarGenerationEnabled:
        body.avatarGenerationEnabled ?? hierarchy.avatarGenerationEnabled ?? true,
      maxTier2Agents: body.maxTier2Agents ?? hierarchy.maxTier2Agents ?? 3,
      maxTier3Agents: body.maxTier3Agents ?? hierarchy.maxTier3Agents ?? 10,
      defaultRetryLimit: body.defaultRetryLimit ?? hierarchy.defaultRetryLimit ?? 3,
      modelPriorityTier1And2: body.modelPriorityTier1And2 ?? hierarchy.modelPriorityTier1And2 ?? [],
      modelPriorityTier3: body.modelPriorityTier3 ?? hierarchy.modelPriorityTier3 ?? [],
    };
    saveConfig({ hierarchy: next } as Partial<import('@adytum/shared').AdytumConfig>);
    return reply.send(next);
  }
}
