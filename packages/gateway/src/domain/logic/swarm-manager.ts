/**
 * @file packages/gateway/src/domain/logic/swarm-manager.ts
 * @description Manages the lifecycle of the Adytum Swarm (Agents).
 */

import { singleton, inject, delay } from 'tsyringe';
import { v4 as uuid } from 'uuid';
import { uniqueNamesGenerator, adjectives, colors, animals } from 'unique-names-generator';
import { EventEmitter } from 'node:events';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type AdytumAgent, type AgentStatus, SwarmEvents, SwarmMessage } from '@adytum/shared';
import { EventBusService } from '../../infrastructure/events/event-bus.js';
import { loadConfig } from '../../config.js';
import { SwarmMessenger } from './swarm-messenger.js';
import { CronManager } from '../../application/services/cron-manager.js';
import { AgentRegistry, AgentProfile } from '../agents/agent-registry.js';

@singleton()
export class SwarmManager {
  private activeAgents: Map<string, AdytumAgent> = new Map();
  private graveyard: AdytumAgent[] = [];
  private graveyardPath: string;

  private cryostasisPath: string;
  private frozenAgents: Map<string, AdytumAgent> = new Map();

  private cronManager?: CronManager;

  constructor(
    @inject('RuntimeConfig') private config: any,
    @inject(EventBusService) private eventBus: EventBusService,
    @inject(SwarmMessenger) private messenger: SwarmMessenger,
    @inject('AgentRegistry') private agentRegistry: AgentRegistry,
  ) {
    this.graveyardPath = join(config.dataPath, 'graveyard.json');
    this.cryostasisPath = join(config.dataPath, 'cryostasis.json');
    this.hydrateGraveyard();
    this.hydrateCryostasis();

    // 1. Register the Main Architect as the first agent
    const mainAgentId = config.agentId || 'prometheus';
    const mainAgent: AdytumAgent = {
      id: mainAgentId,
      parentId: null,
      name: config.agentName || 'Adytum Architect',
      role: 'Swarm Architect',
      type: 'architect',
      status: 'idle',
      isRecurring: false,
      createdAt: Date.now(),
      avatarUrl: `https://api.dicebear.com/9.x/bottts/svg?seed=${mainAgentId}`,
      tools: [], // Filled dynamically
      metadata: { system: true, tier: 1 },
    };
    this.activeAgents.set(mainAgentId, mainAgent);

    // 2. Hydrate from persistent AgentRegistry
    this.hydrateFromRegistry();

    // 3. Thaw persistent agents on startup (cryostasis)
    this.thawAllAgents();
  }

  private hydrateFromRegistry() {
    const records = this.agentRegistry.getAllRecords();
    console.log(`[SwarmManager] Hydrating from Registry: ${records.length} records found.`);

    for (const record of records) {
      // If already in activeAgents (like the architect), skip
      if (this.activeAgents.has(record.id)) continue;

      // Only hydrate those that haven't taken their last breath and aren't in cryostasis
      if (record.lastBreath === null && !this.frozenAgents.has(record.id)) {
        const agent: AdytumAgent = {
          id: record.id,
          parentId: record.parentId,
          name: record.name,
          role: record.role || 'Assistant',
          type: record.tier === 1 ? 'architect' : record.tier === 2 ? 'manager' : 'worker',
          avatarUrl: record.avatar || '',
          status: 'idle',
          isRecurring: record.mode === 'daemon' || record.mode === 'scheduled',
          createdAt: record.birthTime * 1000,
          tools: record.modelIds || [], // This is slightly off but AdytumAgent.tools is string[]
          metadata: {
            mission: record.mission,
            mode: record.mode,
            tier: record.tier,
            cronSchedule: record.cronSchedule,
          },
        };
        // Note: Tools might need re-determination or better storage.
        // For now, satisfy the type.
        if (agent.tools.length === 0) {
          agent.tools = this.determineToolsForRole(agent.role);
        }

        this.activeAgents.set(agent.id, agent);
        console.log(`[SwarmManager] Restored active agent: ${agent.name} (${agent.id})`);
      }
    }
  }

  /**
   * Sets the cron manager instance (breaking circular dependency).
   */
  public setCronManager(cronManager: CronManager) {
    this.cronManager = cronManager;
  }

  /**
   * Spawns a new sub-agent worker.
   */
  public createAgent(options: {
    parentId: string | null;
    role: string;
    mission: string;
    agentType?: 'manager' | 'worker';
    mode?: 'reactive' | 'daemon' | 'scheduled';
    tier?: number;
    cronSchedule?: string;
    inheritedTools?: string[];
  }): AdytumAgent {
    const {
      parentId,
      role,
      mission,
      agentType = 'worker',
      mode = 'reactive',
      tier = 2,
      cronSchedule,
      inheritedTools = [],
    } = options;

    const id = uuid();
    const name = uniqueNamesGenerator({
      dictionaries: [adjectives, colors, animals],
      separator: ' ',
      style: 'capital',
    });

    const isRecurring = mode === 'daemon' || mode === 'scheduled';

    const newAgent: AdytumAgent = {
      id,
      parentId,
      name,
      role,
      type: agentType as any,
      avatarUrl: `https://api.dicebear.com/9.x/bottts/svg?seed=${id}`,
      status: 'spawning',
      isRecurring,
      createdAt: Date.now(),
      tools: this.determineToolsForRole(role, inheritedTools),
      metadata: {
        mission,
        mode,
        tier,
        cronSchedule,
      },
    };

    this.activeAgents.set(id, newAgent);

    // Register in persistent registry
    const profile: AgentProfile = {
      id,
      name,
      tier: tier as 1 | 2 | 3,
      mission,
      parentId,
      status: 'idle',
      modelId: 'default',
      avatar: newAgent.avatarUrl || '',
      mode,
      cronSchedule,
      persistence: 'persistent',
      createdAt: newAgent.createdAt,
    };
    this.agentRegistry.register(profile);

    // [Unified Scheduling] Register with CronManager if scheduled
    if (mode === 'scheduled' && cronSchedule && this.cronManager) {
      const mission = newAgent.metadata?.mission || 'Scheduled task';
      this.cronManager.addJob(
        `Automated Task: ${newAgent.name} (${newAgent.role})`,
        cronSchedule,
        mission,
        newAgent.id,
      );
    }

    // Emit event for Dashboard
    this.eventBus.publish(SwarmEvents.AGENT_SPAWNED, newAgent, 'SwarmManager');

    return newAgent;
  }

  /**
   * Terminates an agent, moving it to the graveyard or putting it to sleep.
   */
  public terminateAgent(agentId: string, reason?: string): void {
    const agent = this.activeAgents.get(agentId);
    if (!agent) return;

    if (agent.type === 'architect') {
      console.warn('Cannot terminate the Architect.');
      return;
    }

    if (agent.isRecurring) {
      agent.status = 'asleep';
      this.freezeAgent(agent);
      this.activeAgents.delete(agentId); // Remove from active memory to save resources
      this.eventBus.publish(
        SwarmEvents.AGENT_UPDATED,
        { id: agentId, status: 'asleep' },
        'SwarmManager',
      );
    } else {
      agent.status = 'dead';
      agent.terminatedAt = Date.now();

      this.graveyard.push(agent);
      this.activeAgents.delete(agentId);
      this.persistGraveyard();

      // Update registry
      this.agentRegistry.lastBreath(agentId);

      this.eventBus.publish(SwarmEvents.AGENT_TERMINATED, { id: agentId }, 'SwarmManager');
    }
  }

  /**
   * Freezes an agent state to disk (Cryostasis).
   */
  private freezeAgent(agent: AdytumAgent) {
    this.frozenAgents.set(agent.id, agent);
    this.persistCryostasis();
    console.log(`[SwarmManager] Agent ${agent.name} (${agent.id}) frozen to cryostasis.`);
  }

  /**
   * Thaws all agents from cryostasis into active memory.
   */
  private thawAllAgents() {
    if (this.frozenAgents.size === 0) return;

    console.log(`[SwarmManager] Thawing ${this.frozenAgents.size} agents from cryostasis...`);
    for (const [id, agent] of this.frozenAgents) {
      agent.status = 'idle'; // Reset status on thaw
      this.activeAgents.set(id, agent);
      this.eventBus.publish(SwarmEvents.AGENT_SPAWNED, agent, 'SwarmManager');
    }
    // We keep them in frozenAgents map as "backup" or clear it?
    // Usually we keep it until they change state, but for simplicity let's clear inactive ones?
    // Actually, createAgent adds to activeAgents. freeze removes from active and adds to frozen.
    // So thaw should add to active and remove from frozen?
    // Let's keep them in frozen map as the "persistence source" but maybe mark them active.
    // For now, simple implementation: thaw moves to active.
    this.frozenAgents.clear();
    this.persistCryostasis();
  }

  /**
   * Returns the current agent hierarchy.
   */
  public getHierarchy(): AdytumAgent[] {
    return Array.from(this.activeAgents.values());
  }

  public sendMessage(msg: SwarmMessage) {
    this.messenger.send(msg.fromAgentId, msg.toAgentId, msg.content, msg.type);
  }

  public broadcast(fromAgentId: string, content: string, type: SwarmMessage['type'] = 'alert') {
    this.messenger.broadcast(fromAgentId, content, type);
  }

  public getAgent(id: string): AdytumAgent | undefined {
    return this.activeAgents.get(id);
  }

  public getAllAgents(): AdytumAgent[] {
    return Array.from(this.activeAgents.values());
  }

  public getGraveyard(): AdytumAgent[] {
    return this.graveyard;
  }

  private determineToolsForRole(role: string, inheritedTools: string[] = []): string[] {
    // Basic logic to scope tools based on role keywords
    const baseTools = ['file_read', 'file_search', 'task_and_execute'];
    let roleTools: string[] = [];

    const r = role.toLowerCase();
    if (r.includes('research')) {
      roleTools = ['web_fetch', 'web_search'];
    } else if (r.includes('engineer') || r.includes('refactor') || r.includes('developer')) {
      roleTools = ['file_write', 'shell_execute', 'file_list'];
    } else {
      // Default fallback
      roleTools = ['file_write', 'shell_execute', 'web_fetch'];
    }

    // Merge and deduplicate
    return Array.from(new Set([...baseTools, ...roleTools, ...inheritedTools]));
  }

  private hydrateGraveyard() {
    try {
      if (existsSync(this.graveyardPath)) {
        const data = readFileSync(this.graveyardPath, 'utf-8');
        this.graveyard = JSON.parse(data);
      }
    } catch (error) {
      console.error('Failed to load graveyard:', error);
    }
  }

  private persistGraveyard() {
    try {
      writeFileSync(this.graveyardPath, JSON.stringify(this.graveyard, null, 2));
    } catch (error) {
      console.error('Failed to save graveyard:', error);
    }
  }

  private hydrateCryostasis() {
    try {
      if (existsSync(this.cryostasisPath)) {
        const data = readFileSync(this.cryostasisPath, 'utf-8');
        const entryArray = JSON.parse(data) as [string, AdytumAgent][];
        this.frozenAgents = new Map(entryArray);
      }
    } catch (error) {
      console.error('Failed to load cryostasis:', error);
    }
  }

  private persistCryostasis() {
    try {
      const entryArray = Array.from(this.frozenAgents.entries());
      writeFileSync(this.cryostasisPath, JSON.stringify(entryArray, null, 2));
    } catch (error) {
      console.error('Failed to save cryostasis:', error);
    }
  }
}
