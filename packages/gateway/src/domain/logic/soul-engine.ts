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
}
