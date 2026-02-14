import { singleton, inject } from 'tsyringe';
import { MemoryDB } from './memory-db.js';
import { ConfigService } from '../config/config-service.js';
import { Logger } from '../../logger.js';
import { MemoryRepository, MemoryEntity } from '../../domain/interfaces/memory-repository.interface.js';

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

  async addMessage(sessionId: string, role: string, content: string): Promise<void> {
    this.db.addMessage(sessionId, role, content);
  }

  async getRecentMessages(limit: number = 40): Promise<any[]> {
    return this.db.getRecentMessages(limit);
  }

  async addMemory(memory: Omit<MemoryEntity, 'id' | 'createdAt'>): Promise<MemoryEntity> {
    return this.db.addMemory(memory);
  }

  async searchMemories(query: string, topK: number = 3): Promise<MemoryEntity[]> {
    return this.db.searchMemories(query, topK);
  }

  async getMemoriesFiltered(categories: string[] = [], limit: number = 50, offset: number = 0): Promise<MemoryEntity[]> {
    return this.db.getMemoriesFiltered(categories, limit, offset);
  }

  async updateMemory(id: string, updates: Partial<Omit<MemoryEntity, 'id' | 'createdAt'>>): Promise<MemoryEntity | null> {
    return this.db.updateMemory(id, updates);
  }

  async deleteMemory(id: string): Promise<boolean> {
    return this.db.deleteMemory(id);
  }

  async setMeta(key: string, value: string): Promise<void> {
    this.db.setMeta(key, value);
  }

  async getMeta(key: string): Promise<string | null> {
    return this.db.getMeta(key);
  }

  public getLegacyDB(): MemoryDB {
    return this.db;
  }
}
