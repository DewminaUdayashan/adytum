export interface RequestContext {
  sessionId: string;
  role: string;
  content: string;
}

export interface MemoryEntity {
  id: string;
  content: string;
  source: string;
  category: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  createdAt: number;
}

export interface MemoryRepository {
  // Chat Context
  addMessage(sessionId: string, role: string, content: string): Promise<void>;
  getRecentMessages(limit?: number): Promise<any[]>; // TODO: typed MessageRow

  // Long-term Memory
  addMemory(memory: Omit<MemoryEntity, 'id' | 'createdAt'>): Promise<MemoryEntity>;
  searchMemories(query: string, topK?: number): Promise<MemoryEntity[]>;
  getMemoriesFiltered(categories?: string[], limit?: number, offset?: number): Promise<MemoryEntity[]>;
  updateMemory(id: string, updates: Partial<Omit<MemoryEntity, 'id' | 'createdAt'>>): Promise<MemoryEntity | null>;
  deleteMemory(id: string): Promise<boolean>;

  // Meta/KV
  setMeta(key: string, value: string): Promise<void>;
  getMeta(key: string): Promise<string | null>;
}
