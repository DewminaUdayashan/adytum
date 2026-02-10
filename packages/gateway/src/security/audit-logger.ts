import { v4 as uuid } from 'uuid';
import type { SecurityEvent, AgentLog } from '@adytum/shared';
import { EventEmitter } from 'node:events';

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
 */
export class AuditLogger extends EventEmitter {
  private buffer: LogEntry[] = [];
  private securityEvents: SecurityEvent[] = [];

  log(entry: Omit<LogEntry, 'id' | 'timestamp'>): LogEntry {
    const full: LogEntry = {
      id: uuid(),
      timestamp: Date.now(),
      ...entry,
    };

    this.buffer.push(full);
    this.emit('log', full);
    return full;
  }

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

  logToolCall(traceId: string, toolName: string, args: Record<string, unknown>): LogEntry {
    return this.log({
      traceId,
      actionType: 'tool_call',
      payload: { tool: toolName, arguments: args },
      status: 'pending',
    });
  }

  logToolResult(traceId: string, toolName: string, result: unknown, isError: boolean): LogEntry {
    return this.log({
      traceId,
      actionType: 'tool_result',
      payload: { tool: toolName, result, isError },
      status: isError ? 'error' : 'success',
    });
  }

  logModelCall(traceId: string, model: string, messageCount: number): LogEntry {
    return this.log({
      traceId,
      actionType: 'model_call',
      payload: { model, messageCount },
      status: 'pending',
    });
  }

  logModelResponse(
    traceId: string,
    model: string,
    tokenUsage?: LogEntry['tokenUsage'],
  ): LogEntry {
    return this.log({
      traceId,
      actionType: 'model_response',
      payload: { model },
      status: 'success',
      tokenUsage,
    });
  }

  logThinking(traceId: string, thought: string): LogEntry {
    return this.log({
      traceId,
      actionType: 'thinking',
      payload: { thought },
      status: 'success',
    });
  }

  logSubAgentSpawn(traceId: string, childTraceId: string, goal: string): LogEntry {
    return this.log({
      traceId,
      actionType: 'sub_agent_spawn',
      payload: { childTraceId, goal },
      status: 'pending',
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

  getRecentLogs(count: number = 50): LogEntry[] {
    return this.buffer.slice(-count);
  }
}

// Singleton instance
export const auditLogger = new AuditLogger();
