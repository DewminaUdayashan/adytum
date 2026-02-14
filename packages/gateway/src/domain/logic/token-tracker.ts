/**
 * @file packages/gateway/src/domain/logic/token-tracker.ts
 * @description Contains domain logic and core business behavior.
 */

import type { TokenUsage, ModelRole } from '@adytum/shared';
import { EventEmitter } from 'node:events';

export interface TokenRecord {
  model: string;
  role: ModelRole;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCost: number;
  timestamp: number;
  sessionId: string;
}

/**
 * Tracks token usage per model, per session, and cumulative.
 * Emits events for real-time dashboard updates.
 */
export class TokenTracker extends EventEmitter {
  private records: TokenRecord[] = [];
  private sessionTotals = new Map<string, { tokens: number; cost: number }>();
  private modelTotals = new Map<string, { tokens: number; cost: number }>();
  private grandTotal = { tokens: 0, cost: 0 };

  /**
   * Executes filter records.
   * @param from - From.
   * @param to - To.
   * @returns The resulting collection of values.
   */
  private filterRecords(from?: number, to?: number): TokenRecord[] {
    return this.records.filter((r) => {
      const afterFrom = typeof from === 'number' ? r.timestamp >= from : true;
      const beforeTo = typeof to === 'number' ? r.timestamp <= to : true;
      return afterFrom && beforeTo;
    });
  }

  /**
   * Executes record.
   * @param usage - Usage.
   * @param sessionId - Session id.
   */
  record(usage: TokenUsage, sessionId: string): void {
    const record: TokenRecord = {
      ...usage,
      timestamp: Date.now(),
      estimatedCost: usage.estimatedCost ?? 0,
      sessionId,
    };

    this.records.push(record);

    // Update session totals
    const session = this.sessionTotals.get(sessionId) || { tokens: 0, cost: 0 };
    session.tokens += usage.totalTokens;
    session.cost += usage.estimatedCost ?? 0;
    this.sessionTotals.set(sessionId, session);

    // Update model totals
    const model = this.modelTotals.get(usage.model) || { tokens: 0, cost: 0 };
    model.tokens += usage.totalTokens;
    model.cost += usage.estimatedCost ?? 0;
    this.modelTotals.set(usage.model, model);

    // Update grand total
    this.grandTotal.tokens += usage.totalTokens;
    this.grandTotal.cost += usage.estimatedCost ?? 0;

    // Emit for WebSocket streaming
    this.emit('token_update', {
      ...record,
      cumulativeTokens: this.grandTotal.tokens,
      cumulativeCost: this.grandTotal.cost,
    });
  }

  /**
   * Retrieves session usage.
   * @param sessionId - Session id.
   * @returns The get session usage result.
   */
  getSessionUsage(sessionId: string): { tokens: number; cost: number } {
    return this.sessionTotals.get(sessionId) || { tokens: 0, cost: 0 };
  }

  /**
   * Retrieves model usage.
   * @param model - Model.
   * @returns The get model usage result.
   */
  getModelUsage(model: string): { tokens: number; cost: number } {
    return this.modelTotals.get(model) || { tokens: 0, cost: 0 };
  }

  /**
   * Retrieves total usage.
   * @param from - From.
   * @param to - To.
   * @returns The get total usage result.
   */
  getTotalUsage(from?: number, to?: number): { tokens: number; cost: number } {
    if (from || to) {
      const records = this.filterRecords(from, to);
      return records.reduce(
        (acc, r) => {
          acc.tokens += r.totalTokens;
          acc.cost += r.estimatedCost;
          return acc;
        },
        { tokens: 0, cost: 0 },
      );
    }
    return { ...this.grandTotal };
  }

  /**
   * Retrieves daily usage.
   * @param from - From.
   * @param to - To.
   * @returns The get daily usage result.
   */
  getDailyUsage(
    from?: number,
    to?: number,
  ): Array<{
    date: string;
    tokens: number;
    cost: number;
    model: string;
    role: ModelRole;
    calls: number;
  }> {
    const daily = new Map<
      string,
      { tokens: number; cost: number; model: string; role: ModelRole; calls: number }
    >();

    for (const record of this.filterRecords(from, to)) {
      const date = new Date(record.timestamp).toISOString().split('T')[0];
      const key = `${date}:${record.model}:${record.role}`;
      const existing = daily.get(key) || {
        tokens: 0,
        cost: 0,
        model: record.model,
        role: record.role,
        calls: 0,
      };
      existing.tokens += record.totalTokens;
      existing.cost += record.estimatedCost;
      existing.calls += 1;
      daily.set(key, existing);
    }

    return Array.from(daily.entries()).map(([key, data]) => ({
      date: key.split(':')[0],
      ...data,
    }));
  }

  /**
   * Retrieves recent records.
   * @param count - Count.
   * @param from - From.
   * @param to - To.
   * @returns The resulting collection of values.
   */
  getRecentRecords(count: number = 50, from?: number, to?: number): TokenRecord[] {
    const filtered = this.filterRecords(from, to);
    return filtered.slice(-count);
  }

  /** Flush records for DB persistence. */
  flush(): TokenRecord[] {
    const records = [...this.records];
    this.records = [];
    return records;
  }
}

export const tokenTracker = new TokenTracker();
