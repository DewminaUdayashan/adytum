/**
 * @file packages/gateway/src/infrastructure/repositories/memory-store.ts
 * @description Implements infrastructure adapters and external integrations.
 */

import type { MemoryDB, MemoryRow } from './memory-db.js';

export type MemoryCategory =
  | 'episodic_raw'
  | 'episodic_summary'
  | 'dream'
  | 'monologue'
  | 'curiosity'
  | 'general'
  | 'user_fact';

export interface MemoryRecord extends MemoryRow {}

/**
 * Executes redact secrets.
 * @param input - Input.
 * @returns The resulting string value.
 */
export function redactSecrets(input: string): string {
  if (!input) return input;

  const patterns: Array<{
    regex: RegExp;
    replace: string | ((match: string, key?: string) => string);
  }> = [
    // Discord token format (current and legacy lengths)
    {
      regex: /\b[A-Za-z0-9_\-]{20,40}\.[A-Za-z0-9_\-]{4,10}\.[A-Za-z0-9_\-]{20,120}\b/g,
      replace: '[REDACTED_DISCORD_TOKEN]',
    },
    // Clean up previously partial-redacted token artifacts
    {
      regex: /\b[A-Za-z0-9_\-]*\[REDACTED_DISCORD_TOKEN\][A-Za-z0-9_\-]*\b/g,
      replace: '[REDACTED_DISCORD_TOKEN]',
    },
    // OpenAI-style keys
    { regex: /\bsk-[A-Za-z0-9]{20,}\b/g, replace: '[REDACTED_API_KEY]' },
    // Google API keys
    { regex: /\bAIza[0-9A-Za-z\-_]{35}\b/g, replace: '[REDACTED_API_KEY]' },
    // Common env assignments
    {
      regex:
        /\b(ADYTUM_[A-Z0-9_]*_TOKEN|DISCORD_BOT_TOKEN|OPENAI_API_KEY|ANTHROPIC_API_KEY|GEMINI_API_KEY|COHERE_API_KEY)\b\s*[:=]\s*[`'"]?([^\s`'"]+)[`'"]?/gi,
      replace: (_match: string, key?: string) => `${key}=[REDACTED]`,
    },
    // Discord IDs in env assignment style
    {
      regex:
        /\b(ADYTUM_DISCORD_DEFAULT_CHANNEL_ID|ADYTUM_DISCORD_GUILD_ID|ADYTUM_DISCORD_USER_ID)\b\s*[:=]\s*[`'"]?(\d{17,20})[`'"]?/gi,
      replace: (_match: string, key?: string) => `${key}=[REDACTED_DISCORD_ID]`,
    },
    // Discord channel URLs with IDs
    {
      regex: /discord\.com\/channels\/\d{17,20}\/\d{17,20}(?:\/\d{17,20})?/gi,
      replace:
        'discord.com/channels/[REDACTED_DISCORD_ID]/[REDACTED_DISCORD_ID]/[REDACTED_DISCORD_ID]',
    },
    // Human-written Discord ID lines
    {
      regex: /(\bDiscord(?:\s+(?:User|Channel|Guild))?\s+ID\b[^0-9]{0,20})\d{17,20}/gi,
      replace: '$1[REDACTED_DISCORD_ID]',
    },
  ];

  return patterns.reduce((text, { regex, replace }) => text.replace(regex, replace as any), input);
}

/**
 * Encapsulates memory store behavior.
 */
export class MemoryStore {
  constructor(private db: MemoryDB) {
    this.db.redactSensitiveData(redactSecrets);
  }

  /**
   * Executes add.
   * @param content - Content.
   * @param source - Source.
   * @param tags - Tags.
   * @param metadata - Metadata.
   * @param category - Category.
   * @returns The add result.
   */
  add(
    content: string,
    source: MemoryRow['source'],
    tags?: string[],
    metadata?: Record<string, unknown>,
    category: MemoryCategory = 'general',
    workspaceId?: string,
  ): MemoryRecord {
    const sanitized = redactSecrets(content);
    return this.db.addMemory({ content: sanitized, source, category, tags, metadata, workspaceId });
  }

  /**
   * Executes list.
   * @param limit - Limit.
   * @returns The resulting collection of values.
   */
  list(limit: number = 50): MemoryRecord[] {
    return this.db.listMemories(limit);
  }

  /**
   * Executes search.
   * @param query - Query.
   * @param topK - Top k.
   * @returns The resulting collection of values.
   */
  search(query: string, topK: number = 3): MemoryRecord[] {
    return this.db.searchMemories(query, topK);
  }
}
