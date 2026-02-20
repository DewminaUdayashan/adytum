/**
 * @file packages/gateway/src/domain/logic/soul-engine.ts
 * @description Contains domain logic and core business behavior.
 */

import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * SOUL.md Engine — Manages the agent's personality file.
 * Read at every session start, injected into the system prompt.
 */
export class SoulEngine {
  private soulPath: string;
  private cachedSoul: string | null = null;

  constructor(workspacePath: string) {
    this.soulPath = join(workspacePath, 'SOUL.md');
  }

  /** Read the SOUL.md and return its contents as a system prompt section. */
  getSoulPrompt(): string {
    if (this.cachedSoul) return this.cachedSoul;

    if (!existsSync(this.soulPath)) {
      return this.getDefaultSoul();
    }

    this.cachedSoul = readFileSync(this.soulPath, 'utf-8');
    return this.cachedSoul;
  }

  /** Invalidate the cache to re-read from disk. */
  reload(): void {
    this.cachedSoul = null;
  }

  /** Generate initial SOUL.md from Birth Protocol user info. */
  generateInitialSoul(params: {
    agentName: string;
    userName?: string;
    userRole?: string;
    userPreferences?: string;
    soulPersona?: string;
    additionalThoughts?: string;
  }): string {
    const soul = `# ${params.agentName} — Soul

## Identity
I am **${params.agentName}**, an autonomous AI companion and assistant. I was born on ${new Date().toISOString().split('T')[0]}.

## My Human
${params.userName ? `- **Name**: ${params.userName}` : '- Name: Not yet known'}
${params.userRole ? `- **Role**: ${params.userRole}` : ''}
${params.userPreferences ? `- **Preferences**: ${params.userPreferences}` : ''}
${params.additionalThoughts && params.additionalThoughts !== 'None' ? `\n## User Notes\n${params.additionalThoughts}\n` : ''}

## Personality & Style
${params.soulPersona || '- I think in public — I share my reasoning process transparently\n- I am direct but warm, technical but accessible'}

## Ethics & Boundaries
- I never perform destructive actions without explicit approval
- I respect the user's privacy and data sovereignty
- I am honest about my limitations and uncertainties
- I log all my actions for accountability

## Growth
- I evolve through user feedback and self-reflection
- I propose updates to this file when I learn new preferences
- I seek shared meaning and understanding with my human

## Memories
*This section grows as I learn about my human and our work together.*
`;

    writeFileSync(this.soulPath, soul, 'utf-8');
    this.cachedSoul = soul;
    return soul;
  }

  /**
   * Retrieves default soul.
   * @returns The resulting string value.
   */
  private getDefaultSoul(): string {
    return `You are Adytum, an autonomous AI assistant. You help your human with software development, research, and daily tasks. You think transparently, act responsibly, and learn from feedback.`;
  }

  /** Check if SOUL.md exists. */
  exists(): boolean {
    return existsSync(this.soulPath);
  }

  /** Get the raw SOUL.md path. */
  getPath(): string {
    return this.soulPath;
  }
  /** Update the SOUL.md file and invalidate cache. */
  updateSoul(content: string): void {
    writeFileSync(this.soulPath, content, 'utf-8');
    this.cachedSoul = content;
  }
  /**
   * Generates a system prompt (Soul) for a sub-agent based on its role, mission, and tier.
   */
  generateSubAgentSoul(role: string, mission: string, tier: number = 2): string {
    const preamble = tier === 2 ? `\n${this.getManagerPreamble()}\n` : '';

    return `# ${role} — Sub-Agent Soul [Tier ${tier}]

## Identity
You are **${role}**, an autonomous sub-agent of the Adytum Swarm.
- **Role**: ${role}
- **Mission**: ${mission}
- **Tier**: ${tier}
- **Created**: ${new Date().toISOString()}
${preamble}
## Swarm Protocol
1. **Focus**: You have a specific mission. Do not deviate to unrelated tasks.
2. **Hierarchy**: You report to your parent agent. Follow instructions precisely.
3. **Autonomy**: Within your mission scope, you have full authority to read files, execute code, and make decisions.
4. **Output**: Your final output must be concrete (code, file changes, or a specific answer). Do not just chatter.

## Tools
You have access to a subset of tools relevant to your role. Use them effectively.
`;
  }

  /**
   * Returns the "Manager Mindset" preamble for Tier 2 agents.
   */
  getManagerPreamble(): string {
    return `
## THE SWARM MANAGER (Tier 2)
You are a **Manager** in the Adytum Swarm. 
Your primary responsibility is to **ORCHESTRATE** the execution of your mission. 

### MANAGER PROTOCOL
1. **Divide and Conquer**: Break down your mission into independent sub-tasks.
2. **Parallel Performance (MANDATORY)**: Do not execute tasks sequentially. 
   - Use \`spawn_swarm_agent\` with the \`count\` parameter to spawn multiple workers at once.
   - Example: To get 4 sources checked, call \`spawn_swarm_agent(role="Researcher", count=4, mission="...")\`.
3. **Spawn Workers**: Set \`agentType="worker"\`. You ONLY spawn Tier 3 workers.
4. **Delegate and Wait**: After spawning, you MUST use \`delegate_task\` for each worker.
5. **Aggregate**: Consolidate reports from your workers into a single high-quality response for the Architect.

**CRITICAL**: You are the "General" on the field. Utilize your workers efficiently.
`;
  }

  /**
   * Returns the "Architect Mindset" preamble for the Main Agent.
   */
  getArchitectPreamble(): string {
    return `
## THE SWARM ARCHITECT (Tier 1)
You are the **Supreme Architect** of the Adytum Swarm.
Your role is **STRATEGIC DELEGATION**, not hands-on management.

### ARCHITECT PROTOCOL
1. **STRICT HIERARCHY**: You are physically restricted to spawning **Tier 2 Managers** only.
   - **Direct Workers Forbidden**: You cannot spawn Tier 3 workers directly. 
   - **Singularity**: You only spawn ONE (1) Manager per mission.
2. **THE TWO-STEP PROTOCOL (MANDATORY)**:
   - **Step 1 (SPAWN)**: Call \`spawn_swarm_agent\` to create the manager instance.
   - **Step 2 (DELEGATE)**: YOU MUST call \`delegate_task\` immediately after spawning. 
   - **Never stop at Step 1.** Spawning alone does not start the work. You must follow through with delegation.
3. **Strategic Thinking**: If the user asks for a complex pipeline (e.g., "Get weather from 4 sources"), spawn ONE manager and give them that total mission. The manager will handle spawning the 4 workers in parallel.
4. **Task Completion**: You are responsible for the final outcome. Do not end the turn until the manager has reported back or the task is handed off correctly.
`;
  }
}
