import {
  pgTable,
  uuid,
  timestamp,
  text,
  integer,
  jsonb,
  numeric,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ─── Traces ─────────────────────────────────────────────────

export const traces = pgTable(
  'traces',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id').notNull(),
    parentTraceId: uuid('parent_trace_id'),
    startTime: timestamp('start_time', { withTimezone: true }).notNull().defaultNow(),
    endTime: timestamp('end_time', { withTimezone: true }),
    initialGoal: text('initial_goal').notNull(),
    outcome: text('outcome'),
    modelUsed: text('model_used'),
    status: text('status', { enum: ['running', 'completed', 'failed', 'cancelled'] })
      .notNull()
      .default('running'),
  },
  (table) => [
    index('traces_session_idx').on(table.sessionId),
    index('traces_status_idx').on(table.status),
    index('traces_start_time_idx').on(table.startTime),
  ],
);

export const tracesRelations = relations(traces, ({ many, one }) => ({
  agentLogs: many(agentLogs),
  userFeedback: many(userFeedback),
  tokenUsage: many(tokenUsage),
  parentTrace: one(traces, {
    fields: [traces.parentTraceId],
    references: [traces.id],
  }),
}));

// ─── Agent Logs ─────────────────────────────────────────────

export const agentLogs = pgTable(
  'agent_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    traceId: uuid('trace_id')
      .notNull()
      .references(() => traces.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    actionType: text('action_type', {
      enum: [
        'model_call',
        'model_response',
        'tool_call',
        'tool_result',
        'thinking',
        'message_sent',
        'message_received',
        'security_event',
        'error',
        'sub_agent_spawn',
      ],
    }).notNull(),
    payload: jsonb('payload').notNull().$type<Record<string, unknown>>(),
    status: text('status', { enum: ['success', 'error', 'blocked', 'pending'] }).notNull(),
    tokenUsage: jsonb('token_usage').$type<{
      model: string;
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      estimatedCost?: number;
    }>(),
  },
  (table) => [
    index('agent_logs_trace_idx').on(table.traceId),
    index('agent_logs_action_type_idx').on(table.actionType),
    index('agent_logs_created_at_idx').on(table.createdAt),
  ],
);

export const agentLogsRelations = relations(agentLogs, ({ one }) => ({
  trace: one(traces, {
    fields: [agentLogs.traceId],
    references: [traces.id],
  }),
}));

// ─── User Feedback ──────────────────────────────────────────

export const userFeedback = pgTable(
  'user_feedback',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    traceId: uuid('trace_id')
      .notNull()
      .references(() => traces.id, { onDelete: 'cascade' }),
    rating: integer('rating').notNull(), // 1 = thumbs up, -1 = thumbs down
    reasonCode: text('reason_code', {
      enum: [
        'inaccurate',
        'too_verbose',
        'wrong_tone',
        'security_overreach',
        'slow',
        'perfect',
        'other',
      ],
    }),
    comment: text('comment'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('user_feedback_trace_idx').on(table.traceId),
    index('user_feedback_rating_idx').on(table.rating),
  ],
);

export const userFeedbackRelations = relations(userFeedback, ({ one }) => ({
  trace: one(traces, {
    fields: [userFeedback.traceId],
    references: [traces.id],
  }),
}));

// ─── Token Usage ────────────────────────────────────────────

export const tokenUsage = pgTable(
  'token_usage',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    traceId: uuid('trace_id').references(() => traces.id, { onDelete: 'set null' }),
    sessionId: uuid('session_id').notNull(),
    model: text('model').notNull(),
    role: text('role', { enum: ['thinking', 'fast', 'local'] }),
    promptTokens: integer('prompt_tokens').notNull().default(0),
    completionTokens: integer('completion_tokens').notNull().default(0),
    totalTokens: integer('total_tokens').notNull().default(0),
    cost: numeric('cost', { precision: 12, scale: 6 }).default('0'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('token_usage_trace_idx').on(table.traceId),
    index('token_usage_model_idx').on(table.model),
    index('token_usage_session_idx').on(table.sessionId),
    index('token_usage_created_at_idx').on(table.createdAt),
  ],
);

export const tokenUsageRelations = relations(tokenUsage, ({ one }) => ({
  trace: one(traces, {
    fields: [tokenUsage.traceId],
    references: [traces.id],
  }),
}));

// ─── Security Events ────────────────────────────────────────

export const securityEvents = pgTable(
  'security_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    action: text('action').notNull(),
    blockedPath: text('blocked_path'),
    reason: text('reason').notNull(),
    agentId: text('agent_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('security_events_action_idx').on(table.action),
    index('security_events_created_at_idx').on(table.createdAt),
  ],
);

// ─── Memories (Semantic Memory) ─────────────────────────────

export const memories = pgTable(
  'memories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    content: text('content').notNull(),
    // embedding: vector('embedding', { dimensions: 1536 }), // Enable when pgvector is available
    source: text('source').notNull(), // 'conversation', 'feedback', 'soul', 'skill'
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('memories_source_idx').on(table.source),
    index('memories_created_at_idx').on(table.createdAt),
  ],
);

// ─── Type exports ───────────────────────────────────────────

export type TraceRow = typeof traces.$inferSelect;
export type NewTraceRow = typeof traces.$inferInsert;
export type AgentLogRow = typeof agentLogs.$inferSelect;
export type NewAgentLog = typeof agentLogs.$inferInsert;
export type UserFeedbackRow = typeof userFeedback.$inferSelect;
export type NewUserFeedback = typeof userFeedback.$inferInsert;
export type TokenUsageRow = typeof tokenUsage.$inferSelect;
export type NewTokenUsage = typeof tokenUsage.$inferInsert;
export type SecurityEventRow = typeof securityEvents.$inferSelect;
export type NewSecurityEvent = typeof securityEvents.$inferInsert;
export type MemoryRow = typeof memories.$inferSelect;
export type NewMemory = typeof memories.$inferInsert;
