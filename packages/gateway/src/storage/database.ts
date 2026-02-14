/**
 * @file packages/gateway/src/storage/database.ts
 * @description Implements storage setup and persistence helpers.
 */

import { drizzle as drizzlePg } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '@adytum/shared';
import { EventEmitter } from 'node:events';

export type DatabaseType = 'postgresql' | 'sqlite';

export interface DatabaseConnection {
  type: DatabaseType;
  db: ReturnType<typeof drizzlePg>;
  close: () => Promise<void>;
}

let connection: DatabaseConnection | null = null;

/**
 * Initialize the database connection.
 * Uses the connection string from storage provisioning.
 */
export async function initDatabase(connectionString: string): Promise<DatabaseConnection> {
  if (connection) return connection;

  const client = postgres(connectionString);
  const db = drizzlePg(client, { schema });

  connection = {
    type: 'postgresql',
    db,
    close: async () => {
      await client.end();
      connection = null;
    },
  };

  // Run auto-migration (create tables if they don't exist)
  await runMigrations(client);

  return connection;
}

/**
 * Get the active database connection.
 */
export function getDatabase(): DatabaseConnection | null {
  return connection;
}

/**
 * Auto-create tables if they don't exist.
 * Uses raw SQL for simplicity — Drizzle push could also be used.
 */
async function runMigrations(client: ReturnType<typeof postgres>): Promise<void> {
  await client.unsafe(`
    CREATE TABLE IF NOT EXISTS traces (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      session_id UUID NOT NULL,
      parent_trace_id UUID,
      start_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      end_time TIMESTAMPTZ,
      initial_goal TEXT NOT NULL,
      outcome TEXT,
      model_used TEXT,
      status TEXT NOT NULL DEFAULT 'running'
    );

    CREATE INDEX IF NOT EXISTS traces_session_idx ON traces(session_id);
    CREATE INDEX IF NOT EXISTS traces_status_idx ON traces(status);
    CREATE INDEX IF NOT EXISTS traces_start_time_idx ON traces(start_time);

    CREATE TABLE IF NOT EXISTS agent_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      trace_id UUID NOT NULL REFERENCES traces(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      action_type TEXT NOT NULL,
      payload JSONB NOT NULL,
      status TEXT NOT NULL,
      token_usage JSONB
    );

    CREATE INDEX IF NOT EXISTS agent_logs_trace_idx ON agent_logs(trace_id);
    CREATE INDEX IF NOT EXISTS agent_logs_action_type_idx ON agent_logs(action_type);
    CREATE INDEX IF NOT EXISTS agent_logs_created_at_idx ON agent_logs(created_at);

    CREATE TABLE IF NOT EXISTS user_feedback (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      trace_id UUID NOT NULL REFERENCES traces(id) ON DELETE CASCADE,
      rating INTEGER NOT NULL,
      reason_code TEXT,
      comment TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS user_feedback_trace_idx ON user_feedback(trace_id);
    CREATE INDEX IF NOT EXISTS user_feedback_rating_idx ON user_feedback(rating);

    CREATE TABLE IF NOT EXISTS token_usage (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      trace_id UUID REFERENCES traces(id) ON DELETE SET NULL,
      session_id UUID NOT NULL,
      model TEXT NOT NULL,
      role TEXT,
      prompt_tokens INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      cost NUMERIC(12,6) DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS token_usage_trace_idx ON token_usage(trace_id);
    CREATE INDEX IF NOT EXISTS token_usage_model_idx ON token_usage(model);
    CREATE INDEX IF NOT EXISTS token_usage_session_idx ON token_usage(session_id);
    CREATE INDEX IF NOT EXISTS token_usage_created_at_idx ON token_usage(created_at);

    CREATE TABLE IF NOT EXISTS security_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      action TEXT NOT NULL,
      blocked_path TEXT,
      reason TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS security_events_action_idx ON security_events(action);
    CREATE INDEX IF NOT EXISTS security_events_created_at_idx ON security_events(created_at);

    CREATE TABLE IF NOT EXISTS memories (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      content TEXT NOT NULL,
      source TEXT NOT NULL,
      metadata JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS memories_source_idx ON memories(source);
    CREATE INDEX IF NOT EXISTS memories_created_at_idx ON memories(created_at);
  `);
}
