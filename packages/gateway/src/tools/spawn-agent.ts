/**
 * @file packages/gateway/src/tools/spawn-agent.ts
 * @description Tool for Prometheus (and Tier 2) to spawn Tier 2/3 sub-agents via Birth Protocol.
 */

import { z } from 'zod';
import { v4 as uuid } from 'uuid';
import type { ToolDefinition } from '@adytum/shared';
import type { AgentRegistry } from '../domain/agents/agent-registry.js';
import type { LogbookService } from '../application/services/logbook-service.js';
import type { AgentLogStore } from '../domain/agents/agent-log-store.js';
import type { SubAgentSpawner } from '../domain/logic/sub-agent.js';

const COOL_NAMES = [
  'Titan',
  'Viper',
  'Echo',
  'Atlas',
  'Nova',
  'Orion',
  'Cipher',
  'Flux',
  'Zenith',
  'Apex',
  'Rogue',
  'Ghost',
  'Shadow',
  'Neo',
  'Trinity',
];

const SpawnSubAgentSchema = z
  .object({
    goal: z
      .string()
      .optional()
      .describe('Clear, focused task for the sub-agent. REQUIRED if "batch" is NOT provided.'),
    tier: z
      .preprocess(
        (val) => (val === '2' || val === 2 ? 2 : val === '3' || val === 3 ? 3 : val),
        z.union([z.literal(2), z.literal(3)]),
      )
      .describe(
        'Tier 2 = Manager (coordinator), Tier 3 = Operative (micro-task). Pass 2 or 3 (number or string).',
      ),
    name: z
      .string()
      .optional()
      .describe('Display name for the agent. If omitted, a cool codename will be generated.'),
    role: z
      .string()
      .optional()
      .describe(
        'Job role/title (e.g. "News Researcher", "Code Reviewer"). Helps identify function.',
      ),
    parent_id: z.string().uuid().optional().describe('Parent agent ID (default: current agent).'),
    deactivate_after: z
      .boolean()
      .optional()
      .describe(
        'If true (default), deactivate agent after task. Set FALSE for persistent agents (e.g. daily cron workers).',
      ),
    model: z
      .string()
      .optional()
      .describe(
        'Specific model ID from available chain (e.g. "gpt-4o-mini") to optimize root agent spawning.',
      ),
    batch: z
      .array(
        z.object({
          goal: z.string().describe('Clear, focused task for this specific sub-agent'),
          name: z.string().optional().describe('Unique name for this sub-agent'),
          role: z.string().optional().describe('Specific role for this sub-agent'),
          parent_id: z
            .string()
            .uuid()
            .optional()
            .describe('Parent agent ID for this specific sub-agent (overrides top-level default).'),
          model: z
            .string()
            .optional()
            .describe(
              'Specific model ID from the available chain (e.g. "gpt-4o-mini", "claude-3-haiku") to optimize costs.',
            ),
          deactivate_after: z
            .boolean()
            .optional()
            .describe('Override default persistence for this specific agent'),
        }),
      )
      .optional()
      .describe('List of tasks to execute in parallel. If provided, top-level "goal" is optional.'),
    sessionId: z.string().optional(),
    workspaceId: z.string().optional(),
  })
  .passthrough();

export type SpawnSubAgentArgs = z.infer<typeof SpawnSubAgentSchema>;

/** Callback to generate avatar URL for a newly born agent (e.g. via DiceBear). */
export type GenerateAvatarFn = (name: string, tier: number) => Promise<string | null>;

/**
 * Creates the spawn_sub_agent tool so Prometheus (or Tier 2) can spawn sub-agents during a run.
 * When the LLM calls this tool, we Birth the agent, run the goal, log to LOGBOOK, and optionally Last Breath.
 * If generateAvatar is provided and hierarchy.avatarGenerationEnabled, avatars are generated per agent.
 */
export function createSpawnAgentTool(
  agentRegistry: AgentRegistry,
  logbookService: LogbookService,
  agentLogStore: AgentLogStore,
  subAgentSpawner: SubAgentSpawner,
  prometheusAgentId: string,
  options?: { generateAvatar?: GenerateAvatarFn; avatarEnabled?: boolean },
): ToolDefinition {
  return {
    name: 'spawn_sub_agent',
    description:
      'Spawn Tier 3 (Operative) agents to perform work. \n\n**BATCH EXECUTION (RECOMMENDED)**: Use the `batch` parameter to spawn multiple agents in parallel (e.g. 5 web scrapers, 3 researchers) in a single tool call. This is vastly faster and preferred over sequential spawning.\n\nHIERARCHY: Tier 2 Managers should ONLY spawn Tier 3 Operatives. Do not nest deeper.',
    parameters: SpawnSubAgentSchema,
    execute: async (args: unknown) => {
      const parsed = SpawnSubAgentSchema.safeParse(args);
      if (!parsed.success) {
        return `Invalid arguments: ${parsed.error.message}`;
      }

      const {
        goal,
        tier,
        parent_id,
        deactivate_after,
        batch,
        sessionId: ctxSessionId,
        workspaceId: ctxWorkspaceId,
      } = parsed.data;
      const { name, role } = parsed.data;

      // VALIDATION: Goal is required if batch is missing
      if (!batch && !goal) {
        return "Error: 'goal' is required unless 'batch' is provided.";
      }

      const parentId = parent_id ?? prometheusAgentId;
      const parentSessionId = ctxSessionId ?? uuid();
      const parentTraceId = uuid();

      // Helper to generate name if missing or sanitize
      const getName = (n?: string) => {
        if (n && n.trim().length > 0) {
          // Strip common prefixes to force "Callsign Only" style
          return n.replace(/^(Agent|Weather|Scout|Tier\d)-/i, '').trim();
        }
        return (
          COOL_NAMES[Math.floor(Math.random() * COOL_NAMES.length)] +
          '-' +
          Math.floor(Math.random() * 100)
        );
      };

      // ─────────────────────────────────────────────────────────────────────────────
      // BATCH MODE
      // ─────────────────────────────────────────────────────────────────────────────
      if (batch && batch.length > 0) {
        const results = await Promise.all(
          batch.map(async (item) => {
            const itemName = getName(item.name);
            const itemRole = item.role || role || (tier === 2 ? 'Manager' : 'Operative');
            const itemParentId = item.parent_id ?? parentId;

            // PERSISTENCE LOGIC:
            // 1. If explicit 'deactivate_after' provided in item, use it.
            // 2. If 'deactivate_after' provided at top level, use it.
            // 3. If agent is REUSED (persistent), default to FALSE.
            // 4. Otherwise default to TRUE.

            let meta;
            let childSessionId: string | undefined;
            let isReused = false;

            // Check for reuse
            const existingAgent = agentRegistry.findActiveByName(itemName);
            if (existingAgent) {
              meta = agentRegistry.get(existingAgent.id)!;
              childSessionId = existingAgent.activeSessionId;
              isReused = true;
            } else {
              childSessionId = uuid();
              try {
                meta = agentRegistry.birth({
                  name: itemName,
                  tier: tier as 2 | 3,
                  parentId: itemParentId,
                  avatarUrl: null,
                  role: itemRole,
                  model: item.model, // specific model for this task
                  sessionId: childSessionId,
                });
              } catch (e: any) {
                return `[${itemName}] Failed to birth: ${e.message}`;
              }
              if (options?.avatarEnabled && options?.generateAvatar) {
                try {
                  const avatarUrl = await options.generateAvatar(itemName, tier as number);
                  if (avatarUrl) agentRegistry.setAvatar(meta.id, avatarUrl);
                } catch {
                  // ignore
                }
              }
            }

            // Determine persistence
            let shouldDeactivate = true; // Default
            if (item.deactivate_after !== undefined) shouldDeactivate = item.deactivate_after;
            else if (deactivate_after !== undefined) shouldDeactivate = deactivate_after;
            else if (isReused) shouldDeactivate = false; // Auto-persist reused agents

            logbookService.append({
              timestamp: Date.now(),
              agentId: meta.id,
              agentName: meta.name,
              tier: meta.tier,
              event: isReused ? 'revival' : 'birth',
              detail: `${isReused ? 'Reusing' : 'Spawned'} for batch task. Goal: ${item.goal.slice(0, 50)}...`,
            });

            const goalWithContext =
              tier === 2
                ? `[Context: You are ${itemRole} "${meta.name}" (ID: ${meta.id}). When spawning sub-agents, pass parent_id: "${meta.id}".]\n\nTask: ${item.goal}`
                : item.goal;

            try {
              const result = await subAgentSpawner.spawn({
                parentTraceId,
                parentSessionId,
                goal: goalWithContext,
                tier: tier as number,
                sessionId: childSessionId,
                agentId: meta.id, // Pass the known agent ID to setup correct tool hierarchy
              });

              if (shouldDeactivate) {
                agentRegistry.lastBreath(meta.id);
              }

              return `[${meta.name} (${meta.tier === 2 ? 'Manager' : 'Tier 3'})] result:\n${result.result}`;
            } catch (err: any) {
              return `[${meta.name}] Failed: ${err.message}`;
            }
          }),
        );

        return `Batch Execution Completed:\n\n${results.join('\n\n---\n\n')}`;
      }

      // Helper to spawn a single agent
      const spawnSingle = async (
        itemGoal: string,
        itemName?: string,
        itemRole?: string,
        itemDeactivate?: boolean,
        itemModel?: string,
      ) => {
        const displayName = getName(itemName);
        const displayRole = itemRole || role || (tier === 2 ? 'Manager' : 'Operative');

        let meta;
        let childSessionId: string | undefined;
        let isReused = false;

        // Check if agent exists by name (Persistence Logic)
        const existingAgent = agentRegistry.findActiveByName(displayName);

        if (existingAgent) {
          // REUSE EXISTING AGENT
          meta = agentRegistry.get(existingAgent.id)!;
          childSessionId = existingAgent.activeSessionId;
          isReused = true;

          logbookService.append({
            timestamp: Date.now(),
            agentId: meta.id,
            agentName: meta.name,
            tier: meta.tier,
            event: 'revival',
            detail: `Reusing existing persistent agent (Session: ${childSessionId || 'new'}). Goal: ${itemGoal.slice(0, 80)}...`,
          });
        } else {
          // BIRTH NEW AGENT
          childSessionId = uuid(); // Generate persistent session ID for this new agent
          try {
            meta = agentRegistry.birth({
              name: displayName,
              tier: tier as 2 | 3,
              parentId,
              avatarUrl: null,
              role: displayRole,
              model: itemModel,
              sessionId: childSessionId, // Store specific session ID
            });
          } catch (e: any) {
            return `Failed to birth agent ${displayName}: ${e.message}`;
          }

          if (options?.avatarEnabled && options?.generateAvatar) {
            try {
              const avatarUrl = await options.generateAvatar(displayName, tier);
              if (avatarUrl) agentRegistry.setAvatar(meta.id, avatarUrl);
            } catch {
              // ignore
            }
          }

          logbookService.append({
            timestamp: Date.now(),
            agentId: meta.id,
            agentName: meta.name,
            tier: meta.tier,
            event: 'birth',
            detail: `Spawned as ${displayRole}. Goal: ${itemGoal.slice(0, 80)}...`,
          });
        }

        // Determine persistence
        let shouldDeactivate = true; // Default
        if (itemDeactivate !== undefined) shouldDeactivate = itemDeactivate;
        else if (deactivate_after !== undefined) shouldDeactivate = deactivate_after;
        else if (isReused) shouldDeactivate = false; // Auto-persist reused agents

        agentLogStore.append(meta.id, 'thought', `Role: ${displayRole}. Goal: ${itemGoal}`, {
          goal: itemGoal,
          tier,
          role: displayRole,
        });

        // So Tier 2 can pass parent_id when spawning Tier 3
        const goalWithContext =
          tier === 2
            ? `[Context: You are ${displayRole} "${meta.name}" (ID: ${meta.id}). When spawning sub-agents, pass parent_id: "${meta.id}".]\n\nTask: ${itemGoal}`
            : itemGoal;

        try {
          const result = await subAgentSpawner.spawn({
            parentTraceId,
            parentSessionId,
            goal: goalWithContext,
            tier: tier as number,
            sessionId: childSessionId, // Force specific session ID for reuse
          });

          agentLogStore.append(meta.id, 'action', `Completed: ${result.result.slice(0, 200)}...`, {
            toolCalls: result.toolCalls,
            traceId: result.traceId,
          });

          logbookService.append({
            timestamp: Date.now(),
            agentId: meta.id,
            agentName: meta.name,
            tier: meta.tier,
            event: 'task_complete',
            detail: `Tool calls: ${result.toolCalls}. Result length: ${result.result.length}`,
          });

          if (shouldDeactivate) {
            agentRegistry.lastBreath(meta.id);
            logbookService.append({
              timestamp: Date.now(),
              agentId: meta.id,
              agentName: meta.name,
              tier: meta.tier,
              event: 'last_breath',
              detail: 'Deactivated after task (deactivate_after=true)',
            });
          }

          return `[${meta.name} (Tier ${tier})] result:\n${result.result}`;
        } catch (err: any) {
          agentLogStore.append(meta.id, 'action', `Failed: ${err?.message ?? String(err)}`, {
            error: true,
          });
          logbookService.append({
            timestamp: Date.now(),
            agentId: meta.id,
            agentName: meta.name,
            tier: meta.tier,
            event: 'task_failed',
            detail: err?.message ?? String(err),
          });
          if (shouldDeactivate) {
            agentRegistry.lastBreath(meta.id);
          }
          return `[${meta.name}] failed: ${err?.message ?? String(err)}`;
        }
      };

      // Single Execution
      if (!goal) return "Error: 'goal' is required if 'batch' is not provided.";
      const { model } = parsed.data;
      return spawnSingle(goal, name, role, deactivate_after, model);
    },
  };
}
