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

export class MemoryStore {
  constructor(private db: MemoryDB) {}

  add(
    content: string,
    source: MemoryRow['source'],
    tags?: string[],
    metadata?: Record<string, unknown>,
    category: MemoryCategory = 'general',
  ): MemoryRecord {
    return this.db.addMemory({ content, source, category, tags, metadata });
  }

  list(limit: number = 50): MemoryRecord[] {
    return this.db.listMemories(limit);
  }

  search(query: string, topK: number = 3): MemoryRecord[] {
    return this.db.searchMemories(query, topK);
  }
}
