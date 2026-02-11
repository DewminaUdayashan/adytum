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

export class MemoryDB {
  private db: Database.Database;

  constructor(dataPath: string) {
    const sqliteDir = join(dataPath, 'sqlite');
    mkdirSync(sqliteDir, { recursive: true });
    const dbPath = join(sqliteDir, 'adytum.db');
    this.db = new Database(dbPath);
    this.migrate();
  }

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

  addMessage(sessionId: string, role: string, content: string): void {
    const stmt = this.db.prepare(
      'INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)'
    );
    stmt.run(crypto.randomUUID(), sessionId, role, content, Date.now());
  }

  getRecentMessages(limit: number = 40): MessageRow[] {
    const stmt = this.db.prepare(
      'SELECT id, session_id as sessionId, role, content, created_at as createdAt FROM messages ORDER BY created_at DESC LIMIT ?'
    );
    const rows = stmt.all(limit) as MessageRow[];
    return rows.reverse();
  }

  addMemory(record: Omit<MemoryRow, 'id' | 'createdAt'>): MemoryRow {
    const id = crypto.randomUUID();
    const createdAt = Date.now();
    const stmt = this.db.prepare(
      'INSERT INTO memories (id, content, source, category, tags, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
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
      this.db.prepare('INSERT INTO memories_fts (content, memory_id) VALUES (?, ?)').run(record.content, id);
    } catch {
      // ignore if FTS unavailable
    }

    return { id, createdAt, ...record };
  }

  listMemories(limit: number = 50): MemoryRow[] {
    const stmt = this.db.prepare(
      'SELECT id, content, source, category, tags, metadata, created_at as createdAt FROM memories ORDER BY created_at DESC LIMIT ?'
    );
    const rows = stmt.all(limit) as Array<Omit<MemoryRow, 'tags' | 'metadata'> & { tags?: string; metadata?: string }>
    return rows.map((r) => ({
      ...r,
      tags: r.tags ? JSON.parse(r.tags) : undefined,
      metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
    }));
  }

  searchMemories(query: string, topK: number = 3): MemoryRow[] {
    try {
      const stmt = this.db.prepare(
        `SELECT m.id, m.content, m.source, m.category, m.tags, m.metadata, m.created_at as createdAt
         FROM memories_fts f
         JOIN memories m ON m.id = f.memory_id
         WHERE memories_fts MATCH ?
         ORDER BY bm25(memories_fts)
         LIMIT ?`
      );
      const rows = stmt.all(query, topK) as Array<Omit<MemoryRow, 'tags' | 'metadata'> & { tags?: string; metadata?: string }>
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
         LIMIT ?`
      );
      const rows = stmt.all(`%${query}%`, topK) as Array<Omit<MemoryRow, 'tags' | 'metadata'> & { tags?: string; metadata?: string }>
      return rows.map((r) => ({
        ...r,
        tags: r.tags ? JSON.parse(r.tags) : undefined,
        metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
      }));
    }
  }

  addActionLog(traceId: string, actionType: string, payload: Record<string, unknown>, status: string): void {
    const stmt = this.db.prepare(
      'INSERT INTO action_logs (id, trace_id, action_type, payload, status, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    );
    stmt.run(crypto.randomUUID(), traceId, actionType, JSON.stringify(payload), status, Date.now());
  }

  getActionLogsSince(timestamp: number): Array<{ actionType: string; payload: Record<string, unknown>; createdAt: number }> {
    const stmt = this.db.prepare(
      'SELECT action_type as actionType, payload, created_at as createdAt FROM action_logs WHERE created_at > ? ORDER BY created_at ASC'
    );
    const rows = stmt.all(timestamp) as Array<{ actionType: string; payload?: string; createdAt: number }>;
    return rows.map((r) => ({
      actionType: r.actionType,
      payload: r.payload ? JSON.parse(r.payload) : {},
      createdAt: r.createdAt,
    }));
  }

  addThought(content: string): void {
    const stmt = this.db.prepare(
      'INSERT INTO thought_queue (id, content, created_at, status) VALUES (?, ?, ?, ?)'
    );
    stmt.run(crypto.randomUUID(), content, Date.now(), 'pending');
  }

  redactSensitiveData(redact: (text: string) => string): { messages: number; memories: number } {
    let messagesUpdated = 0;
    let memoriesUpdated = 0;

    const messageRows = this.db.prepare('SELECT id, content FROM messages').all() as Array<{ id: string; content: string }>;
    const updateMessage = this.db.prepare('UPDATE messages SET content = ? WHERE id = ?');

    for (const row of messageRows) {
      const cleaned = redact(row.content);
      if (cleaned !== row.content) {
        updateMessage.run(cleaned, row.id);
        messagesUpdated += 1;
      }
    }

    const memoryRows = this.db.prepare('SELECT id, content FROM memories').all() as Array<{ id: string; content: string }>;
    const updateMemory = this.db.prepare('UPDATE memories SET content = ? WHERE id = ?');

    for (const row of memoryRows) {
      const cleaned = redact(row.content);
      if (cleaned !== row.content) {
        updateMemory.run(cleaned, row.id);
        memoriesUpdated += 1;
        try {
          this.db.prepare('DELETE FROM memories_fts WHERE memory_id = ?').run(row.id);
          this.db.prepare('INSERT INTO memories_fts (content, memory_id) VALUES (?, ?)').run(cleaned, row.id);
        } catch {
          // ignore if FTS unavailable
        }
      }
    }

    return { messages: messagesUpdated, memories: memoriesUpdated };
  }

  addPendingUpdate(updateType: 'soul' | 'guidelines', content: string): void {
    const stmt = this.db.prepare(
      'INSERT INTO pending_updates (id, update_type, content, created_at, status) VALUES (?, ?, ?, ?, ?)'
    );
    stmt.run(crypto.randomUUID(), updateType, content, Date.now(), 'pending');
  }

  getMeta(key: string): string | null {
    const stmt = this.db.prepare('SELECT value FROM meta WHERE key = ?');
    const row = stmt.get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setMeta(key: string, value: string): void {
    const stmt = this.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
    stmt.run(key, value);
  }
}
