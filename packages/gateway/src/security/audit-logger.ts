/**
 * @file packages/gateway/src/security/audit-logger.ts
 * @description Provides security utilities and policy enforcement logic.
 */

import { v4 as uuid } from 'uuid';
import type { SecurityEvent, AgentLog } from '@adytum/shared';
import { EventEmitter } from 'node:events';
import { logger } from '../logger.js';

export interface LogEntry {
  id: string;
  traceId: string;
  timestamp: number;
  actionType: AgentLog['actionType'];
  payload: Record<string, unknown>;
  status: AgentLog['status'];
  tokenUsage?: AgentLog['tokenUsage'];
}

/**
 * Central audit logger. Emits events for:
 * - Real-time WebSocket streaming to dashboard
 * - Persistent storage to database
 * - Structured logging to stdout via Pino
 */
export class AuditLogger extends EventEmitter {
  private buffer: LogEntry[] = [];
  private securityEvents: SecurityEvent[] = [];

  /**
   * Executes log.
   * @param entry - Entry.
   * @returns The log result.
   */
  log(entry: Omit<LogEntry, 'id' | 'timestamp'>): LogEntry {
    const full: LogEntry = {
      id: uuid(),
      timestamp: Date.now(),
      ...entry,
    };

    // Log to Pino for observability
    logger.debug(
      {
        traceId: full.traceId,
        action: full.actionType,
        status: full.status,
        ...full.payload,
      },
      `Audit: ${full.actionType}`,
    );

    this.buffer.push(full);
    this.emit('log', full);
    return full;
  }

  /**
   * Executes log security event.
   * @param event - Event.
   * @returns The log security event result.
   */
  logSecurityEvent(event: Omit<SecurityEvent, 'id' | 'timestamp'>): SecurityEvent {
    const full: SecurityEvent = {
      id: uuid(),
      timestamp: Date.now(),
      ...event,
    };

    this.securityEvents.push(full);
    this.emit('security', full);
    return full;
  }

  /**
   * Executes log tool call.
   * @param traceId - Trace id.
   * @param toolName - Tool name.
   * @param args - Args.
   * @returns The log tool call result.
   */
  logToolCall(traceId: string, toolName: string, args: Record<string, unknown>): LogEntry {
    return this.log({
      traceId,
      actionType: 'tool_call',
      payload: { tool: toolName, arguments: args },
      status: 'pending',
    });
  }

  /**
   * Executes log tool result.
   * @param traceId - Trace id.
   * @param toolName - Tool name.
   * @param result - Result.
   * @param isError - Is error.
   * @returns The log tool result result.
   */
  logToolResult(traceId: string, toolName: string, result: unknown, isError: boolean): LogEntry {
    return this.log({
      traceId,
      actionType: 'tool_result',
      payload: { tool: toolName, result, isError },
      status: isError ? 'error' : 'success',
    });
  }

  /**
   * Executes log model call.
   * @param traceId - Trace id.
   * @param model - Model.
   * @param messageCount - Message count.
   * @returns The log model call result.
   */
  logModelCall(traceId: string, model: string, messageCount: number): LogEntry {
    return this.log({
      traceId,
      actionType: 'model_call',
      payload: { model, messageCount },
      status: 'pending',
    });
  }

  /**
   * Executes log model response.
   * @param traceId - Trace id.
   * @param model - Model.
   * @param tokenUsage - Token usage.
   * @returns The log model response result.
   */
  logModelResponse(traceId: string, model: string, tokenUsage?: LogEntry['tokenUsage']): LogEntry {
    return this.log({
      traceId,
      actionType: 'model_response',
      payload: { model },
      status: 'success',
      tokenUsage,
    });
  }

  /**
   * Executes log thinking.
   * @param traceId - Trace id.
   * @param thought - Thought.
   * @returns The log thinking result.
   */
  logThinking(traceId: string, thought: string): LogEntry {
    return this.log({
      traceId,
      actionType: 'thinking',
      payload: { thought },
      status: 'success',
    });
  }

  /**
   * Executes log sub agent spawn.
   * @param traceId - Trace id.
   * @param childTraceId - Child trace id.
   * @param goal - Goal.
   * @returns The log sub agent spawn result.
   */
  logSubAgentSpawn(traceId: string, childTraceId: string, goal: string): LogEntry {
    return this.log({
      traceId,
      actionType: 'sub_agent_spawn',
      payload: { childTraceId, goal },
      status: 'pending',
    });
  }

  /**
   * Executes log system event (e.g. cancellation).
   */
  logSystemEvent(event: string, payload: Record<string, unknown>): LogEntry {
    // Generate a transient trace ID for system events if not part of a larger flow
    const traceId = uuid();
    return this.log({
      traceId,
      actionType: 'system_event',
      payload: { event, ...payload },
      status: 'success',
    });
  }

  /** Flush buffer and return entries for DB persistence. */
  flush(): { logs: LogEntry[]; security: SecurityEvent[] } {
    const logs = [...this.buffer];
    const security = [...this.securityEvents];
    this.buffer = [];
    this.securityEvents = [];
    return { logs, security };
  }

  /**
   * Retrieves recent logs.
   * @param count - Count.
   * @returns The resulting collection of values.
   */
  getRecentLogs(count: number = 50): LogEntry[] {
    return this.buffer.slice(-count);
  }
}

// Singleton instance
export const auditLogger = new AuditLogger();
