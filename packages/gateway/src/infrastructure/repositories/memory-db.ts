/**
 * @file packages/gateway/src/infrastructure/repositories/memory-db.ts
 * @description Implements infrastructure adapters and external integrations.
 */

import Database from 'better-sqlite3';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import crypto from 'node:crypto';

export type MessageRow = {
  id: string;
  sessionId: string;
  role: string;
  content: string;
  createdAt: number;
};

export type MemoryRow = {
  id: string;
  content: string;
  source: string;
  category: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  createdAt: number;
};

export type TokenUsageRow = {
  id: string;
  sessionId: string;
  provider: string;
  model: string;
  modelId: string;
  role: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
  createdAt: number;
};

export type TokenUsageFilter = {
  from?: number;
  to?: number;
  providers?: string[];
  modelIds?: string[];
};

export type TokenUsageTotals = {
  tokens: number;
  cost: number;
  calls: number;
};

export type TokenUsageByProvider = {
  provider: string;
  tokens: number;
  cost: number;
  calls: number;
};

export type TokenUsageByModel = {
  provider: string;
  model: string;
  modelId: string;
  tokens: number;
  cost: number;
  calls: number;
};

export type TokenUsageDaily = {
  date: string;
  provider: string;
  model: string;
  modelId: string;
  role: string;
  tokens: number;
  cost: number;
  calls: number;
};

/**
 * Encapsulates memory db behavior.
 */
export class MemoryDB {
  private db: Database.Database;

  constructor(dataPath: string) {
    const sqliteDir = join(dataPath, 'sqlite');
    mkdirSync(sqliteDir, { recursive: true });
    const dbPath = join(sqliteDir, 'adytum.db');
    this.db = new Database(dbPath);
    this.migrate();
  }

  /**
   * Executes migrate.
   */
  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        source TEXT NOT NULL,
        category TEXT NOT NULL,
        tags TEXT,
        metadata TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS action_logs (
        id TEXT PRIMARY KEY,
        trace_id TEXT,
        action_type TEXT NOT NULL,
        payload TEXT,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS thought_queue (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending'
      );

      CREATE TABLE IF NOT EXISTS token_usage (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        model_id TEXT NOT NULL,
        role TEXT NOT NULL,
        prompt_tokens INTEGER NOT NULL DEFAULT 0,
        completion_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        cost REAL NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS token_usage_created_at_idx ON token_usage(created_at);
      CREATE INDEX IF NOT EXISTS token_usage_provider_idx ON token_usage(provider);
      CREATE INDEX IF NOT EXISTS token_usage_model_id_idx ON token_usage(model_id);
      CREATE INDEX IF NOT EXISTS token_usage_session_idx ON token_usage(session_id);

      CREATE TABLE IF NOT EXISTS pending_updates (
        id TEXT PRIMARY KEY,
        update_type TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending'
      );

      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts
        USING fts5(content, memory_id UNINDEXED);
      `);
    } catch {
      // FTS may be unavailable; fallback to LIKE search
    }
  }

  /**
   * Executes add message.
   * @param sessionId - Session id.
   * @param role - Role.
   * @param content - Content.
   */
  addMessage(sessionId: string, role: string, content: string): void {
    const stmt = this.db.prepare(
      'INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)',
    );
    stmt.run(crypto.randomUUID(), sessionId, role, content, Date.now());
  }

  /**
   * Retrieves recent messages.
   * @param limit - Limit.
   * @returns The resulting collection of values.
   */
  getRecentMessages(limit: number = 40): MessageRow[] {
    const stmt = this.db.prepare(
      'SELECT id, session_id as sessionId, role, content, created_at as createdAt FROM messages ORDER BY created_at DESC LIMIT ?',
    );
    const rows = stmt.all(limit) as MessageRow[];
    return rows.reverse();
  }

  /**
   * Executes add memory.
   * @param record - Record.
   * @returns The add memory result.
   */
  addMemory(record: Omit<MemoryRow, 'id' | 'createdAt'>): MemoryRow {
    const id = crypto.randomUUID();
    const createdAt = Date.now();
    const stmt = this.db.prepare(
      'INSERT INTO memories (id, content, source, category, tags, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    stmt.run(
      id,
      record.content,
      record.source,
      record.category,
      record.tags ? JSON.stringify(record.tags) : null,
      record.metadata ? JSON.stringify(record.metadata) : null,
      createdAt,
    );

    try {
      this.db
        .prepare('INSERT INTO memories_fts (content, memory_id) VALUES (?, ?)')
        .run(record.content, id);
    } catch {
      // ignore if FTS unavailable
    }

    return { id, createdAt, ...record };
  }

  /**
   * Executes list memories.
   * @param limit - Limit.
   * @returns The resulting collection of values.
   */
  listMemories(limit: number = 50): MemoryRow[] {
    const stmt = this.db.prepare(
      'SELECT id, content, source, category, tags, metadata, created_at as createdAt FROM memories ORDER BY created_at DESC LIMIT ?',
    );
    const rows = stmt.all(limit) as Array<
      Omit<MemoryRow, 'tags' | 'metadata'> & { tags?: string; metadata?: string }
    >;
    return rows.map((r) => ({
      ...r,
      tags: r.tags ? JSON.parse(r.tags) : undefined,
      metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
    }));
  }

  /**
   * Executes search memories.
   * @param query - Query.
   * @param topK - Top k.
   * @returns The resulting collection of values.
   */
  searchMemories(query: string, topK: number = 3): MemoryRow[] {
    try {
      const stmt = this.db.prepare(
        `SELECT m.id, m.content, m.source, m.category, m.tags, m.metadata, m.created_at as createdAt
         FROM memories_fts f
         JOIN memories m ON m.id = f.memory_id
         WHERE memories_fts MATCH ?
         ORDER BY bm25(memories_fts)
         LIMIT ?`,
      );
      const rows = stmt.all(query, topK) as Array<
        Omit<MemoryRow, 'tags' | 'metadata'> & { tags?: string; metadata?: string }
      >;
      return rows.map((r) => ({
        ...r,
        tags: r.tags ? JSON.parse(r.tags) : undefined,
        metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
      }));
    } catch {
      const stmt = this.db.prepare(
        `SELECT id, content, source, category, tags, metadata, created_at as createdAt
         FROM memories
         WHERE content LIKE ?
         ORDER BY created_at DESC
         LIMIT ?`,
      );
      const rows = stmt.all(`%${query}%`, topK) as Array<
        Omit<MemoryRow, 'tags' | 'metadata'> & { tags?: string; metadata?: string }
      >;
      return rows.map((r) => ({
        ...r,
        tags: r.tags ? JSON.parse(r.tags) : undefined,
        metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
      }));
    }
  }

  /**
   * Executes add action log.
   * @param traceId - Trace id.
   * @param actionType - Action type.
   * @param payload - Payload.
   * @param status - Status.
   */
  addActionLog(
    traceId: string,
    actionType: string,
    payload: Record<string, unknown>,
    status: string,
  ): void {
    const stmt = this.db.prepare(
      'INSERT INTO action_logs (id, trace_id, action_type, payload, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    );
    stmt.run(crypto.randomUUID(), traceId, actionType, JSON.stringify(payload), status, Date.now());
  }

  /**
   * Retrieves action logs since.
   * @param timestamp - Timestamp.
   * @returns The get action logs since result.
   */
  getActionLogsSince(timestamp: number): Array<{
    actionType: string;
    payload: Record<string, unknown>;
    status: string;
    createdAt: number;
  }> {
    const stmt = this.db.prepare(
      'SELECT action_type as actionType, payload, status, created_at as createdAt FROM action_logs WHERE created_at > ? ORDER BY created_at ASC',
    );
    const rows = stmt.all(timestamp) as Array<{
      actionType: string;
      payload?: string;
      status: string;
      createdAt: number;
    }>;
    return rows.map((r) => ({
      actionType: r.actionType,
      payload: r.payload ? JSON.parse(r.payload) : {},
      status: r.status,
      createdAt: r.createdAt,
    }));
  }

  /**
   * Executes add thought.
   * @param content - Content.
   */
  addThought(content: string): void {
    const stmt = this.db.prepare(
      'INSERT INTO thought_queue (id, content, created_at, status) VALUES (?, ?, ?, ?)',
    );
    stmt.run(crypto.randomUUID(), content, Date.now(), 'pending');
  }

  /**
   * Executes add token usage.
   * @param record - Record.
   * @returns The add token usage result.
   */
  addTokenUsage(
    record: Omit<TokenUsageRow, 'id' | 'createdAt'> & { createdAt?: number },
  ): TokenUsageRow {
    const row: TokenUsageRow = {
      id: crypto.randomUUID(),
      createdAt: record.createdAt ?? Date.now(),
      ...record,
    };

    this.db
      .prepare(
        `INSERT INTO token_usage (
          id, session_id, provider, model, model_id, role, prompt_tokens,
          completion_tokens, total_tokens, cost, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.sessionId,
        row.provider,
        row.model,
        row.modelId,
        row.role,
        row.promptTokens,
        row.completionTokens,
        row.totalTokens,
        row.cost,
        row.createdAt,
      );

    return row;
  }

  /**
   * Retrieves recent token usage.
   * @param limit - Limit.
   * @param filter - Filter.
   * @returns The resulting collection of values.
   */
  getRecentTokenUsage(limit: number = 50, filter: TokenUsageFilter = {}): TokenUsageRow[] {
    const cappedLimit = Math.max(1, Math.min(limit, 500));
    const { whereClause, params } = this.buildTokenUsageWhere(filter);
    const stmt = this.db.prepare(
      `SELECT
          id,
          session_id as sessionId,
          provider,
          model,
          model_id as modelId,
          role,
          prompt_tokens as promptTokens,
          completion_tokens as completionTokens,
          total_tokens as totalTokens,
          cost,
          created_at as createdAt
       FROM token_usage
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT ?`,
    );
    return stmt.all(...params, cappedLimit) as TokenUsageRow[];
  }

  /**
   * Retrieves token usage totals.
   * @param filter - Filter.
   * @returns The get token usage totals result.
   */
  getTokenUsageTotals(filter: TokenUsageFilter = {}): TokenUsageTotals {
    const { whereClause, params } = this.buildTokenUsageWhere(filter);
    const row = this.db
      .prepare(
        `SELECT
          COALESCE(SUM(total_tokens), 0) as tokens,
          COALESCE(SUM(cost), 0) as cost,
          COUNT(*) as calls
         FROM token_usage
         ${whereClause}`,
      )
      .get(...params) as { tokens?: number; cost?: number; calls?: number } | undefined;

    return {
      tokens: Number(row?.tokens || 0),
      cost: Number(row?.cost || 0),
      calls: Number(row?.calls || 0),
    };
  }

  /**
   * Retrieves token usage by provider.
   * @param filter - Filter.
   * @returns The resulting collection of values.
   */
  getTokenUsageByProvider(filter: TokenUsageFilter = {}): TokenUsageByProvider[] {
    const { whereClause, params } = this.buildTokenUsageWhere(filter);
    const rows = this.db
      .prepare(
        `SELECT
          provider,
          COALESCE(SUM(total_tokens), 0) as tokens,
          COALESCE(SUM(cost), 0) as cost,
          COUNT(*) as calls
         FROM token_usage
         ${whereClause}
         GROUP BY provider
         ORDER BY tokens DESC, cost DESC`,
      )
      .all(...params) as Array<{ provider: string; tokens: number; cost: number; calls: number }>;

    return rows.map((row) => ({
      provider: row.provider,
      tokens: Number(row.tokens || 0),
      cost: Number(row.cost || 0),
      calls: Number(row.calls || 0),
    }));
  }

  /**
   * Retrieves token usage by model.
   * @param filter - Filter.
   * @returns The resulting collection of values.
   */
  getTokenUsageByModel(filter: TokenUsageFilter = {}): TokenUsageByModel[] {
    const { whereClause, params } = this.buildTokenUsageWhere(filter);
    const rows = this.db
      .prepare(
        `SELECT
          provider,
          model,
          model_id as modelId,
          COALESCE(SUM(total_tokens), 0) as tokens,
          COALESCE(SUM(cost), 0) as cost,
          COUNT(*) as calls
         FROM token_usage
         ${whereClause}
         GROUP BY provider, model, model_id
         ORDER BY tokens DESC, cost DESC`,
      )
      .all(...params) as Array<{
      provider: string;
      model: string;
      modelId: string;
      tokens: number;
      cost: number;
      calls: number;
    }>;

    return rows.map((row) => ({
      provider: row.provider,
      model: row.model,
      modelId: row.modelId,
      tokens: Number(row.tokens || 0),
      cost: Number(row.cost || 0),
      calls: Number(row.calls || 0),
    }));
  }

  /**
   * Retrieves token usage daily.
   * @param filter - Filter.
   * @returns The resulting collection of values.
   */
  getTokenUsageDaily(filter: TokenUsageFilter = {}): TokenUsageDaily[] {
    const { whereClause, params } = this.buildTokenUsageWhere(filter);
    const rows = this.db
      .prepare(
        `SELECT
          strftime('%Y-%m-%d', created_at / 1000, 'unixepoch') as date,
          provider,
          model,
          model_id as modelId,
          role,
          COALESCE(SUM(total_tokens), 0) as tokens,
          COALESCE(SUM(cost), 0) as cost,
          COUNT(*) as calls
         FROM token_usage
         ${whereClause}
         GROUP BY date, provider, model, model_id, role
         ORDER BY date DESC, tokens DESC`,
      )
      .all(...params) as Array<{
      date: string;
      provider: string;
      model: string;
      modelId: string;
      role: string;
      tokens: number;
      cost: number;
      calls: number;
    }>;

    return rows.map((row) => ({
      date: row.date,
      provider: row.provider,
      model: row.model,
      modelId: row.modelId,
      role: row.role,
      tokens: Number(row.tokens || 0),
      cost: Number(row.cost || 0),
      calls: Number(row.calls || 0),
    }));
  }

  /**
   * Executes build token usage where.
   * @param filter - Filter.
   * @returns The build token usage where result.
   */
  private buildTokenUsageWhere(filter: TokenUsageFilter): {
    whereClause: string;
    params: unknown[];
  } {
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (typeof filter.from === 'number') {
      clauses.push('created_at >= ?');
      params.push(filter.from);
    }
    if (typeof filter.to === 'number') {
      clauses.push('created_at <= ?');
      params.push(filter.to);
    }

    const providers = (filter.providers || []).filter(Boolean);
    if (providers.length > 0) {
      clauses.push(`provider IN (${providers.map(() => '?').join(',')})`);
      params.push(...providers);
    }

    const modelIds = (filter.modelIds || []).filter(Boolean);
    if (modelIds.length > 0) {
      clauses.push(`model_id IN (${modelIds.map(() => '?').join(',')})`);
      params.push(...modelIds);
    }

    return {
      whereClause: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
      params,
    };
  }

  /**
   * Executes redact sensitive data.
   * @param redact - Redact.
   * @returns The redact sensitive data result.
   */
  redactSensitiveData(redact: (text: string) => string): { messages: number; memories: number } {
    let messagesUpdated = 0;
    let memoriesUpdated = 0;

    const messageRows = this.db.prepare('SELECT id, content FROM messages').all() as Array<{
      id: string;
      content: string;
    }>;
    const updateMessage = this.db.prepare('UPDATE messages SET content = ? WHERE id = ?');

    for (const row of messageRows) {
      const cleaned = redact(row.content);
      if (cleaned !== row.content) {
        updateMessage.run(cleaned, row.id);
        messagesUpdated += 1;
      }
    }

    const memoryRows = this.db.prepare('SELECT id, content FROM memories').all() as Array<{
      id: string;
      content: string;
    }>;
    const updateMemory = this.db.prepare('UPDATE memories SET content = ? WHERE id = ?');

    for (const row of memoryRows) {
      const cleaned = redact(row.content);
      if (cleaned !== row.content) {
        updateMemory.run(cleaned, row.id);
        memoriesUpdated += 1;
        try {
          this.db.prepare('DELETE FROM memories_fts WHERE memory_id = ?').run(row.id);
          this.db
            .prepare('INSERT INTO memories_fts (content, memory_id) VALUES (?, ?)')
            .run(cleaned, row.id);
        } catch {
          // ignore if FTS unavailable
        }
      }
    }

    return { messages: messagesUpdated, memories: memoriesUpdated };
  }

  /**
   * Executes add pending update.
   * @param updateType - Update type.
   * @param content - Content.
   */
  addPendingUpdate(updateType: 'soul' | 'guidelines', content: string): void {
    const stmt = this.db.prepare(
      'INSERT INTO pending_updates (id, update_type, content, created_at, status) VALUES (?, ?, ?, ?, ?)',
    );
    stmt.run(crypto.randomUUID(), updateType, content, Date.now(), 'pending');
  }

  /**
   * Retrieves memories filtered.
   * @param categories - Categories.
   * @param limit - Limit.
   * @param offset - Offset.
   * @returns The resulting collection of values.
   */
  getMemoriesFiltered(
    categories: string[] = [],
    limit: number = 50,
    offset: number = 0,
  ): MemoryRow[] {
    const filteredCategories = categories.filter(Boolean);
    const clauses: string[] = [];
    const params: any[] = [];
    if (filteredCategories.length > 0) {
      clauses.push(`category IN (${filteredCategories.map(() => '?').join(',')})`);
      params.push(...filteredCategories);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const stmt = this.db.prepare(
      `SELECT id, content, source, category, tags, metadata, created_at as createdAt
       FROM memories
       ${where}
       ORDER BY created_at DESC
       LIMIT ?
       OFFSET ?`,
    );
    const rows = stmt.all(...params, limit, offset) as Array<
      Omit<MemoryRow, 'tags' | 'metadata'> & { tags?: string; metadata?: string }
    >;
    return rows.map((r) => ({
      ...r,
      tags: r.tags ? JSON.parse(r.tags) : undefined,
      metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
    }));
  }

  /**
   * Executes count memories.
   * @param categories - Categories.
   * @returns The resulting numeric value.
   */
  countMemories(categories: string[] = []): number {
    const filteredCategories = categories.filter(Boolean);
    const clauses: string[] = [];
    const params: any[] = [];
    if (filteredCategories.length > 0) {
      clauses.push(`category IN (${filteredCategories.map(() => '?').join(',')})`);
      params.push(...filteredCategories);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const stmt = this.db.prepare(`SELECT COUNT(*) as c FROM memories ${where}`);
    const row = stmt.get(...params) as { c: number };
    return row?.c || 0;
  }

  /**
   * Retrieves memory.
   * @param id - Id.
   * @returns The get memory result.
   */
  getMemory(id: string): MemoryRow | null {
    const stmt = this.db.prepare(
      'SELECT id, content, source, category, tags, metadata, created_at as createdAt FROM memories WHERE id = ?',
    );
    const row = stmt.get(id) as
      | (Omit<MemoryRow, 'tags' | 'metadata'> & { tags?: string; metadata?: string })
      | undefined;
    if (!row) return null;
    return {
      ...row,
      tags: row.tags ? JSON.parse(row.tags) : undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    };
  }

  /**
   * Executes update memory.
   * @param id - Id.
   * @param updates - Updates.
   * @returns The update memory result.
   */
  updateMemory(
    id: string,
    updates: {
      content?: string;
      category?: string;
      tags?: string[];
      metadata?: Record<string, unknown>;
    },
  ): MemoryRow | null {
    const existing = this.getMemory(id);
    if (!existing) return null;

    const next = {
      ...existing,
      content: updates.content ?? existing.content,
      category: updates.category ?? existing.category,
      tags: updates.tags ?? existing.tags,
      metadata: updates.metadata ?? existing.metadata,
    };

    const stmt = this.db.prepare(
      `UPDATE memories
       SET content = ?, category = ?, tags = ?, metadata = ?
       WHERE id = ?`,
    );
    stmt.run(
      next.content,
      next.category,
      next.tags ? JSON.stringify(next.tags) : null,
      next.metadata ? JSON.stringify(next.metadata) : null,
      id,
    );

    try {
      this.db.prepare('DELETE FROM memories_fts WHERE memory_id = ?').run(id);
      this.db
        .prepare('INSERT INTO memories_fts (content, memory_id) VALUES (?, ?)')
        .run(next.content, id);
    } catch {
      // ignore if FTS unavailable
    }

    return next;
  }

  /**
   * Executes delete memory.
   * @param id - Id.
   * @returns Whether the operation succeeded.
   */
  deleteMemory(id: string): boolean {
    const stmt = this.db.prepare('DELETE FROM memories WHERE id = ?');
    const result = stmt.run(id);
    try {
      this.db.prepare('DELETE FROM memories_fts WHERE memory_id = ?').run(id);
    } catch {
      // ignore if FTS unavailable
    }
    return result.changes > 0;
  }

  /**
   * Sets meta.
   * @param key - Key.
   * @param value - Value.
   */
  setMeta(key: string, value: string): void {
    this.db
      .prepare(
        'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      )
      .run(key, value);
  }

  /**
   * Retrieves meta.
   * @param key - Key.
   * @returns The get meta result.
   */
  getMeta(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
      | { value?: string }
      | undefined;
    return row?.value ?? null;
  }
}
