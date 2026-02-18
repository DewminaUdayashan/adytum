/**
 * @file packages/gateway/src/infrastructure/repositories/memory-store.ts
 * @description Implements infrastructure adapters and external integrations.
 */

import { inject, singleton } from 'tsyringe';
import { EmbeddingService } from '../llm/embedding-service.js';
import type { MemoryDB, MemoryRow } from './memory-db.js';
import { EventBusService } from '../events/event-bus.js';
import { MemoryEvents } from '@adytum/shared';

export type MemoryCategory =
  | 'episodic_raw'
  | 'episodic_summary'
  | 'dream'
  | 'monologue'
  | 'curiosity'
  | 'general'
  | 'user_fact'
  | 'doc_chunk';

export type MemoryRecord = MemoryRow;

/**
 * Executes redact secrets.
 * @param input - Input.
 * @returns The resulting string value.
 */
export function redactSecrets(input: string): string {
  if (!input) return input;

  return input
    .replace(/((?:sk|pk)_(?:live|test)_[a-zA-Z0-9]+)/g, '[REDACTED_KEY]')
    .replace(/(?:ghp|gho)_[a-zA-Z0-9]{36}/g, '[REDACTED_GITHUB_TOKEN]')
    .replace(/xox[baprs]-[a-zA-Z0-9-]+/g, '[REDACTED_SLACK_TOKEN]')
    .replace(
      /\b[A-Za-z0-9_-]{20,40}\.[A-Za-z0-9_-]{4,10}\.[A-Za-z0-9_-]{20,120}\b/g,
      '[REDACTED_DISCORD_TOKEN]',
    )
    .replace(
      /\b[A-Za-z0-9_-]*\[REDACTED_DISCORD_TOKEN\][A-Za-z0-9_-]*\b/g,
      '[REDACTED_DISCORD_TOKEN]',
    )
    .replace(/\bsk-[A-Za-z0-9]{20,}\b/g, '[REDACTED_API_KEY]')
    .replace(/\bAIza[0-9A-Za-z\-_]{35}\b/g, '[REDACTED_API_KEY]')
    .replace(
      /\b(ADYTUM_[A-Z0-9_]*_TOKEN|DISCORD_BOT_TOKEN|OPENAI_API_KEY|ANTHROPIC_API_KEY|GEMINI_API_KEY|COHERE_API_KEY)\b\s*[:=]\s*[`'"]?([^\s`'"]+)[`'"]?/gi,
      (_match: string, key?: string) => `${key}=[REDACTED]`,
    )
    .replace(
      /\b(ADYTUM_DISCORD_DEFAULT_CHANNEL_ID|ADYTUM_DISCORD_GUILD_ID|ADYTUM_DISCORD_USER_ID)\b\s*[:=]\s*[`'"]?(\d{17,20})[`'"]?/gi,
      (_match: string, key?: string) => `${key}=[REDACTED_DISCORD_ID]`,
    )
    .replace(
      /discord\.com\/channels\/\d{17,20}\/\d{17,20}(?:\/\d{17,20})?/gi,
      'discord.com/channels/[REDACTED_DISCORD_ID]/[REDACTED_DISCORD_ID]/[REDACTED_DISCORD_ID]',
    )
    .replace(
      /(\bDiscord(?:\s+(?:User|Channel|Guild))?\s+ID\b[^0-9]{0,20})\d{17,20}/gi,
      '$1[REDACTED_DISCORD_ID]',
    );
}

/**
 * Encapsulates memory store behavior.
 */
@singleton()
export class MemoryStore {
  private eventBus?: EventBusService;

  constructor(
    @inject('MemoryDB') private db: MemoryDB,
    private embeddingService: EmbeddingService,
  ) {
    this.db.redactSensitiveData(redactSecrets);
  }

  /**
   * Sets the event bus instance.
   */
  setEventBus(eventBus: EventBusService) {
    this.eventBus = eventBus;
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
  async add(
    content: string,
    source: MemoryRow['source'],
    tags?: string[],
    metadata?: Record<string, unknown>,
    category: MemoryCategory = 'general',
    workspaceId?: string,
  ): Promise<MemoryRecord> {
    const sanitized = redactSecrets(content);
    let embedding: Buffer | undefined;

    try {
      const vector = await this.embeddingService.embed(sanitized);
      embedding = Buffer.from(vector.buffer);
    } catch (err) {
      console.error('[MemoryStore] Failed to generate embedding:', err);
    }

    const memory = this.db.addMemory({
      content: sanitized,
      source,
      category,
      tags,
      metadata,
      workspaceId,
      embedding, // Add embedding to DB
    });

    if (memory && this.eventBus) {
      this.eventBus.publish(MemoryEvents.CREATED, memory, 'MemoryStore');
    }

    return memory;
  }

  /**
   * Executes add batch.
   * @param items - Items to add.
   */
  async addBatch(
    items: Array<{
      content: string;
      source: MemoryRow['source'];
      tags?: string[];
      metadata?: Record<string, unknown>;
      category?: MemoryCategory;
      workspaceId?: string;
    }>,
  ): Promise<void> {
    const enriched = await Promise.all(
      items.map(async (item) => {
        const sanitized = redactSecrets(item.content);
        let embedding: Buffer | undefined;
        try {
          const vector = await this.embeddingService.embed(sanitized);
          embedding = Buffer.from(vector.buffer);
        } catch (err) {
          console.error('[MemoryStore] Failed to generate embedding:', err);
        }
        return {
          content: sanitized,
          source: item.source,
          category: item.category || 'general',
          tags: item.tags,
          metadata: item.metadata,
          workspaceId: item.workspaceId,
          embedding,
        };
      }),
    );

    this.db.storeStructuredMemories(enriched);

    if (this.eventBus) {
      enriched.forEach((m) => {
        // We construct a mock MemoryRow for event (id/created_at missing but usually fine for simple notification)
        // Ideally DB returns the inserted rows, but storeStructuredMemories is void.
        // We can skip event or fire generic batch event.
        // For now, let's fire created event with partial data if needed, or skip.
        // Skipping individual events for batch to avoid spam.
      });
      // Optionally fire a batch event if EventBus supports it
    }
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

  /**
   * Performs hybrid search (Semantic + Keyword).
   * Currently implements a simple re-ranking or combination strategy.
   */
  async searchHybrid(
    query: string,
    topK: number = 5,
    filter?: { category?: string },
  ): Promise<MemoryRecord[]> {
    // 1. Get query embedding
    const queryVector = await this.embeddingService.embed(query);
    const category = filter?.category || 'doc_chunk';

    // 2. Fetch candidates: Combine Keyword results (BM25) and Recent results
    // This ensures we get both semantically similar AND keyword-matching candidates
    const keywordMatches = this.db.searchMemories(query, 100);
    const recentMatches = this.db.getMemoriesFiltered([category], 1000);

    const candidateMap = new Map<string, MemoryRow>();
    [...keywordMatches, ...recentMatches].forEach((m) => {
      if (m.category === category) candidateMap.set(m.id, m);
    });
    const candidates = Array.from(candidateMap.values());

    if (candidates.length === 0) return [];

    // 3. Score candidates
    const scored = candidates.map((mem) => {
      let score = 0;
      if (mem.embedding) {
        try {
          // Buffer to Float32Array
          const memVector = new Float32Array(
            mem.embedding.buffer,
            mem.embedding.byteOffset,
            mem.embedding.byteLength / 4,
          );
          score = this.embeddingService.cosineSimilarity(queryVector, memVector);
        } catch (err) {
          // Unaligned buffer fallback
          const memVector = new Float32Array(new Uint8Array(mem.embedding).buffer);
          score = this.embeddingService.cosineSimilarity(queryVector, memVector);
        }
      }
      return { ...mem, score };
    });

    // 4. Sort by score
    scored.sort((a, b) => b.score - a.score);

    // 5. Return top K
    return scored.slice(0, topK);
  }
}
