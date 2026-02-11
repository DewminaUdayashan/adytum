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

export function redactSecrets(input: string): string {
  if (!input) return input;

  const patterns: Array<{ regex: RegExp; replace: string | ((match: string, key?: string) => string) }> = [
    // Discord token format
    { regex: /[A-Za-z0-9_\-]{24}\.[A-Za-z0-9_\-]{6}\.[A-Za-z0-9_\-]{27}/g, replace: '[REDACTED_DISCORD_TOKEN]' },
    // OpenAI-style keys
    { regex: /\bsk-[A-Za-z0-9]{20,}\b/g, replace: '[REDACTED_API_KEY]' },
    // Google API keys
    { regex: /\bAIza[0-9A-Za-z\-_]{35}\b/g, replace: '[REDACTED_API_KEY]' },
    // Common env assignments
    {
      regex: /\b(ADYTUM_[A-Z0-9_]*_TOKEN|DISCORD_BOT_TOKEN|OPENAI_API_KEY|ANTHROPIC_API_KEY|GEMINI_API_KEY|COHERE_API_KEY)\b\s*[:=]\s*([^\s]+)/gi,
      replace: (_match: string, key?: string) => `${key}=[REDACTED]`,
    },
  ];

  return patterns.reduce((text, { regex, replace }) => text.replace(regex, replace as any), input);
}

export class MemoryStore {
  constructor(private db: MemoryDB) {
    this.db.redactSensitiveData(redactSecrets);
  }

  add(
    content: string,
    source: MemoryRow['source'],
    tags?: string[],
    metadata?: Record<string, unknown>,
    category: MemoryCategory = 'general',
  ): MemoryRecord {
    const sanitized = redactSecrets(content);
    return this.db.addMemory({ content: sanitized, source, category, tags, metadata });
  }

  list(limit: number = 50): MemoryRecord[] {
    return this.db.listMemories(limit);
  }

  search(query: string, topK: number = 3): MemoryRecord[] {
    return this.db.searchMemories(query, topK);
  }
}
