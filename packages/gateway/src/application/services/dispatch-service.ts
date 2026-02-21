/**
 * @file packages/gateway/src/application/services/dispatch-service.ts
 * @description Manages deterministic command-to-tool mappings for slash commands.
 */

import type { ToolRegistry } from '../../tools/registry.js';
import type { SkillLoader, LoadedSkill } from './skill-loader.js';

export interface CommandDispatch {
  command: string;
  toolName: string;
  skillId: string;
}

export class DispatchService {
  private dispatches: Map<string, CommandDispatch> = new Map();

  constructor(
    private skillLoader: SkillLoader,
    private toolRegistry: ToolRegistry,
  ) {}

  /**
   * Refreshes the dispatch map by scanning all discovered skills.
   */
  refresh(): void {
    this.dispatches.clear();
    const skills = this.skillLoader.getAll();

    for (const skill of skills) {
      if (!skill.enabled || skill.status === 'error') continue;

      const metadata = skill.manifest?.metadata;
      if (!metadata || !metadata.dispatch) continue;

      const { kind, tool } = metadata.dispatch as any;
      if (kind === 'tool' && tool) {
        const command = skill.id.startsWith('/') ? skill.id.slice(1) : skill.id;
        this.dispatches.set(command.toLowerCase(), {
          command,
          toolName: tool,
          skillId: skill.id,
        });
      }
    }
  }

  /**
   * Resolves a slash command to a tool execution if it exists.
   * @param input The raw user input.
   * @returns The dispatch result if found, otherwise null.
   */
  resolve(input: string): { toolName: string; args: Record<string, any> } | null {
    const trimmed = input.trim();
    if (!trimmed.startsWith('/')) return null;

    const parts = trimmed.slice(1).split(/\s+/);
    const command = parts[0].toLowerCase();
    const dispatch = this.dispatches.get(command);

    if (!dispatch) return null;

    // For now, we pass the rest of the string as a 'query' argument by default
    // as most OpenClaw skills expect a single query or similar.
    // We can refine this later to support JSON or positional args.
    const remaining = parts.slice(1).join(' ').trim();

    return {
      toolName: dispatch.toolName,
      args: { query: remaining },
    };
  }

  /**
   * Gets all registered commands.
   */
  getCommands(): string[] {
    return Array.from(this.dispatches.keys());
  }
}
