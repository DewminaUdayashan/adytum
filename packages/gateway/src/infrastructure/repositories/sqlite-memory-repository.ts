/**
 * @file packages/gateway/src/infrastructure/repositories/sqlite-memory-repository.ts
 * @description Implements infrastructure adapters and external integrations.
 */

import { singleton, inject } from 'tsyringe';
import { MemoryDB } from './memory-db.js';
import { ConfigService } from '../config/config-service.js';
import { Logger } from '../../logger.js';
import { MemoryRepository, MemoryEntity } from '../../domain/interfaces/memory-repository.interface.js';

/**
 * Encapsulates sqlite memory repository behavior.
 */
@singleton()
export class SqliteMemoryRepository implements MemoryRepository {
  private db: MemoryDB;

  constructor(
    @inject(ConfigService) private config: ConfigService,
    @inject(Logger) private logger: Logger
  ) {
    const dataPath = this.config.get('dataPath');
    this.logger.info(`Initializing SqliteMemoryRepository at ${dataPath}`);
    this.db = new MemoryDB(dataPath);
  }

  /**
   * Executes add message.
   * @param sessionId - Session id.
   * @param role - Role.
   * @param content - Content.
   */
  async addMessage(sessionId: string, role: string, content: string): Promise<void> {
    this.db.addMessage(sessionId, role, content);
  }

  /**
   * Retrieves recent messages.
   * @param limit - Limit.
   * @returns The resulting collection of values.
   */
  async getRecentMessages(limit: number = 40): Promise<any[]> {
    return this.db.getRecentMessages(limit);
  }

  /**
   * Executes add memory.
   * @param memory - Memory.
   * @returns The add memory result.
   */
  async addMemory(memory: Omit<MemoryEntity, 'id' | 'createdAt'>): Promise<MemoryEntity> {
    return this.db.addMemory(memory);
  }

  /**
   * Executes search memories.
   * @param query - Query.
   * @param topK - Top k.
   * @returns The resulting collection of values.
   */
  async searchMemories(query: string, topK: number = 3): Promise<MemoryEntity[]> {
    return this.db.searchMemories(query, topK);
  }

  /**
   * Retrieves memories filtered.
   * @param categories - Categories.
   * @param limit - Limit.
   * @param offset - Offset.
   * @returns The resulting collection of values.
   */
  async getMemoriesFiltered(categories: string[] = [], limit: number = 50, offset: number = 0): Promise<MemoryEntity[]> {
    return this.db.getMemoriesFiltered(categories, limit, offset);
  }

  /**
   * Executes update memory.
   * @param id - Id.
   * @param updates - Updates.
   * @returns The update memory result.
   */
  async updateMemory(id: string, updates: Partial<Omit<MemoryEntity, 'id' | 'createdAt'>>): Promise<MemoryEntity | null> {
    return this.db.updateMemory(id, updates);
  }

  /**
   * Executes delete memory.
   * @param id - Id.
   * @returns Whether the operation succeeded.
   */
  async deleteMemory(id: string): Promise<boolean> {
    return this.db.deleteMemory(id);
  }

  /**
   * Sets meta.
   * @param key - Key.
   * @param value - Value.
   */
  async setMeta(key: string, value: string): Promise<void> {
    this.db.setMeta(key, value);
  }

  /**
   * Retrieves meta.
   * @param key - Key.
   * @returns The get meta result.
   */
  async getMeta(key: string): Promise<string | null> {
    return this.db.getMeta(key);
  }

  /**
   * Retrieves legacy db.
   * @returns The get legacy db result.
   */
  public getLegacyDB(): MemoryDB {
    return this.db;
  }
}
