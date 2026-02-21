import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { ToolDefinition } from '@adytum/shared';
import { SwarmManager } from '../domain/logic/swarm-manager.js';
import { AgentRuntime } from '../domain/logic/agent-runtime.js';

export function createSwarmTools(
  swarmManager: SwarmManager,
  runtime: AgentRuntime,
): ToolDefinition[] {
  return [
    {
      name: 'spawn_swarm_agent',
      description:
        'Spawn one or more new sub-agents with specific roles and missions. Use this to delegate complex work.',
      parameters: z.object({
        role: z.string().describe('The functional role (e.g., "DevOps Engineer").'),
        mission: z.string().describe('The mission for this agent.'),
        agentType: z
          .enum(['manager', 'worker'])
          .optional()
          .describe(
            'ENFORCED: Tier 1 (Architect) creates "manager" (Tier 2). Managers create "worker" (Tier 3).',
          ),
        mode: z
          .enum(['reactive', 'daemon', 'scheduled'])
          .optional()
          .describe('The execution mode. Default is "reactive".'),
        tier: z
          .number()
          .optional()
          .describe('System Enforced: Architects spawn T2, Managers spawn T3.'),
        count: z
          .number()
          .optional()
          .describe(
            'Number of workers to spawn. ONLY Managers (T2) can spawn multiple. Architects (T1) must spawn 1 manager at a time.',
          ),
        cronSchedule: z.string().optional().describe('CRON expression for scheduled agents.'),
        timeoutMs: z.number().optional().describe('Inactivity timeout in ms (default: 1 hour).'),
        inheritTools: z
          .boolean()
          .optional()
          .default(true)
          .describe('Whether to inherit tools from the parent agent. Default true.'),
        specificTools: z
          .array(z.string())
          .optional()
          .describe('List of specific tools to grant to the agent.'),
      }),
      execute: async (
        args: {
          role: string;
          mission: string;
          agentType?: 'manager' | 'worker';
          mode?: 'reactive' | 'daemon' | 'scheduled';
          tier?: number;
          count?: number;
          cronSchedule?: string;
          timeoutMs?: number;
          inheritTools?: boolean;
          specificTools?: string[];
        },
        context: any,
      ) => {
        try {
          const parentId = context?.agentId || null;
          const parentAgent = parentId ? swarmManager.getAgent(parentId) : null;
          const parentTier = parentAgent?.metadata?.tier || 1;

          let finalTier = args.tier || parentTier + 1;
          let finalAgentType = args.agentType;
          const count = args.count || 1;

          // ─── Hierarchy Enforcement Protocol ───
          if (parentTier === 1) {
            // Architect Protocol
            if (count > 1) {
              return `Hierarchy Violation: The Swarm Architect (Tier 1) can only spawn ONE Manager (Tier 2) at a time to maintain clear delegation. For parallel tasks, spawn a Manager and let THEM spawn workers with the 'count' parameter.`;
            }
            if (args.agentType === 'worker' || finalTier > 2) {
              return `Hierarchy Violation: The Swarm Architect (Tier 1) cannot spawn Workers (Tier 3) directly. You MUST spawn a Tier 2 Manager and delegate the mission to them.`;
            }
            finalAgentType = 'manager';
            finalTier = 2;
          } else if (parentTier === 2) {
            // Manager Protocol
            if (args.agentType === 'manager' || finalTier < 3) {
              return `Hierarchy Violation: Managers (Tier 2) can only spawn Workers (Tier 3). To prevent recursion and maintain hierarchy, Managers cannot spawn other Managers.`;
            }
            finalAgentType = 'worker';
            finalTier = 3;
          }

          // Determine inherited tools
          let inheritedTools: string[] = args.specificTools || [];
          const inheritTools = args.inheritTools ?? true;
          if (inheritTools && parentAgent) {
            inheritedTools = [...inheritedTools, ...parentAgent.tools];
          }

          const spawnedAgents = [];

          for (let i = 0; i < count; i++) {
            const agent = swarmManager.createAgent({
              parentId,
              role: args.role,
              mission: args.mission,
              agentType: finalAgentType,
              mode: args.mode || 'reactive',
              tier: finalTier,
              cronSchedule: args.cronSchedule,
              inheritedTools,
            });

            // Set timeout if provided
            if (args.timeoutMs) {
              agent.timeoutMs = args.timeoutMs;
            }

            spawnedAgents.push(agent);
          }

          const resultList = spawnedAgents.map((a) => `- ${a.name} (${a.id})`).join('\n');
          const firstId = spawnedAgents[0].id;
          return `Successfully spawned ${count} agent(s) [Tier ${finalTier}]:\n${resultList}\n\nRole: ${args.role}\nMission: ${args.mission}\n\n⚠️ **REQUIRED NEXT STEP**: Spawning alone does NOT start the work. You MUST now call "delegate_task(to='${firstId}', goal='Execute your mission') " to activate this agent.`;
        } catch (error: any) {
          return `Failed to spawn agent(s): ${error.message}`;
        }
      },
    },
    {
      name: 'terminate_agent',
      description: 'Terminate an active agent and move it to the graveyard.',
      parameters: z.object({
        agentId: z.string().describe('The unique ID of the agent to terminate.'),
        reason: z.string().optional().describe('The reason for termination.'),
      }),
      execute: async (args: { agentId: string; reason?: string }) => {
        try {
          swarmManager.terminateAgent(args.agentId, args.reason);
          return `Agent ${args.agentId} successfully terminated and moved to graveyard.`;
        } catch (error: any) {
          return `Failed to terminate agent: ${error.message}`;
        }
      },
    },
    {
      name: 'delegate_task',
      description:
        'Delegate a specific task to a sub-agent. The agent will execute the task and return the result.',
      parameters: z.object({
        to: z.string().describe('The unique ID of the agent to delegate to.'),
        goal: z.string().describe('The task instruction or goal for the agent.'),
        timeoutMs: z
          .number()
          .optional()
          .describe('Timeout for this specific delegation (default: 10 mins).'),
        background: z
          .boolean()
          .optional()
          .describe(
            'If true, runs efficiently in background without waiting for full output. Default false (waits for result).',
          ),
      }),
      execute: async (
        args: { to: string; goal: string; timeoutMs?: number; background?: boolean },
        context: any,
      ) => {
        const agent = swarmManager.getAgent(args.to);
        if (!agent) {
          return `Error: Agent with ID "${args.to}" not found. Spawning a new agent might be required.`;
        }

        // Update activity for both parent and child
        if (context?.agentId) swarmManager.updateActivity(context.agentId);
        swarmManager.updateActivity(args.to);

        // Create a dedicated session for this task
        const taskSessionId = `task-${uuidv4()}`;

        // If background execution is requested (e.g. for daemons or long tasks)
        if (args.background) {
          runtime
            .run(args.goal, taskSessionId, { agentId: args.to, workspaceId: context.workspaceId })
            .catch((err) => {
              swarmManager.notifyFailure(args.to, err.message);
              console.error(`Background task failed for ${args.to}:`, err);
            });
          return `Task delegated to ${agent.name} (${args.to}) in background session ${taskSessionId}. Check status later or wait for agent to report back.`;
        }

        // Synchronous execution with timeout
        try {
          const timeout = args.timeoutMs || 10 * 60_000;

          const resultPromise = runtime.run(args.goal, taskSessionId, {
            agentId: args.to,
            workspaceId: context.workspaceId,
          });

          // Implement Promise.race for timeout
          const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error(`Delegation timeout after ${timeout}ms`)), timeout);
          });

          const result: any = await Promise.race([resultPromise, timeoutPromise]);

          return `## Report from ${agent.name} (${agent.role})
Outcome: ${result.trace.outcome}
Status: ${result.trace.status}
Trace ID: ${result.trace.id}

(Session ID: ${taskSessionId})`;
        } catch (error: any) {
          swarmManager.notifyFailure(args.to, error.message);
          return `Delegation failed: ${error.message}`;
        }
      },
    },
    {
      name: 'agent_status',
      description: 'Get detailed status and telemetry for a specific agent.',
      parameters: z.object({
        agentId: z.string().describe('The unique ID of the agent.'),
      }),
      execute: async (args: { agentId: string }) => {
        const agent = swarmManager.getAgent(args.agentId);
        if (!agent) {
          // Check graveyard
          const dead = swarmManager.getGraveyard().find((a) => a.id === args.agentId);
          if (dead) {
            return `Agent ${args.agentId} is in the GRAVEYARD.\nTerminated at: ${new Date(dead.terminatedAt || 0).toISOString()}\nReason: ${dead.metadata?.terminationReason || 'Unknown'}`;
          }
          return `Agent with ID "${args.agentId}" not found.`;
        }

        const now = Date.now();
        const lastActivity = agent.lastActivityAt || agent.createdAt;
        const idleTime = now - lastActivity;
        const uptime = now - agent.createdAt;

        return `## Agent Status: ${agent.name}
ID: ${agent.id}
Role: ${agent.role}
Status: ${agent.status}
Tier: ${agent.metadata?.tier}
Mission: ${agent.metadata?.mission}
Uptime: ${Math.floor(uptime / 1000)}s
Idle Time: ${Math.floor(idleTime / 1000)}s
Last Activity: ${new Date(lastActivity).toISOString()}
Tools: ${agent.tools.join(', ')}
Parent ID: ${agent.parentId || 'None'}`;
      },
    },
    {
      name: 'list_agents',
      description: 'List all active agents in the swarm and their status.',
      parameters: z.object({}),
      execute: async () => {
        const agents = swarmManager.getAllAgents();
        if (agents.length === 0) return 'No active agents in the swarm.';

        let output = '## Active Swarm Agents\n';
        for (const a of agents) {
          output += `- **${a.name}** (${a.role}) [ID: ${a.id}] - ${a.status} (Tier ${a.metadata?.tier || '?'})\n`;
          if (a.metadata?.mission) output += `  Mission: ${a.metadata.mission}\n`;
        }
        return output;
      },
    },
  ];
}
