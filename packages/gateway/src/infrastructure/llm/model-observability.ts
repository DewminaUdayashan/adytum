/**
 * @file packages/gateway/src/infrastructure/llm/model-observability.ts
 * @description Observability layer for the model connectivity system:
 *
 *   - Per-request cost tracking with running totals
 *   - Provider health status aggregation
 *   - Usage analytics (requests, tokens, latency by provider/model)
 *
 * Designed to be consumed by the dashboard API and logging system.
 */

import type { ModelCostConfig } from '@adytum/shared';
import type { ModelEntry } from '../../domain/interfaces/model-repository.interface.js';

// ─── Cost Tracking ────────────────────────────────────────────

export interface RequestCost {
  /** Model that served the request */
  modelId: string;
  /** Provider */
  provider: string;
  /** Tokens consumed */
  inputTokens: number;
  outputTokens: number;
  /** Cached tokens (prompt caching) */
  cachedInputTokens: number;
  /** Computed cost in USD */
  inputCost: number;
  outputCost: number;
  cacheSavings: number;
  totalCost: number;
  /** When the request was made */
  timestamp: number;
}

export interface CostSummary {
  /** Total cost in USD */
  totalCost: number;
  /** Total input tokens */
  totalInputTokens: number;
  /** Total output tokens */
  totalOutputTokens: number;
  /** Total cached tokens */
  totalCachedTokens: number;
  /** Total cache savings in USD */
  totalCacheSavings: number;
  /** Number of requests tracked */
  requestCount: number;
  /** Cost breakdown by provider */
  byProvider: Record<string, { cost: number; requests: number; tokens: number }>;
  /** Cost breakdown by model */
  byModel: Record<string, { cost: number; requests: number; tokens: number }>;
}

// ─── Provider Health ──────────────────────────────────────────

export type ProviderHealthStatus = 'healthy' | 'degraded' | 'down' | 'unknown';

export interface ProviderHealth {
  provider: string;
  status: ProviderHealthStatus;
  /** Success rate (0-1) over the tracking window */
  successRate: number;
  /** Average latency in ms */
  avgLatencyMs: number;
  /** Total requests in tracking window */
  totalRequests: number;
  /** Total errors */
  totalErrors: number;
  /** Whether currently in cooldown */
  inCooldown: boolean;
  /** Last successful request timestamp */
  lastSuccessAt?: number;
  /** Last error timestamp */
  lastErrorAt?: number;
  /** Last error message */
  lastErrorMessage?: string;
}

// ─── Usage Analytics ──────────────────────────────────────────

export interface UsageRecord {
  modelId: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  success: boolean;
  errorType?: string;
  timestamp: number;
}

export interface UsageSummary {
  /** Time window start */
  windowStart: number;
  /** Time window end */
  windowEnd: number;
  /** Total requests */
  totalRequests: number;
  /** Success rate (0-1) */
  successRate: number;
  /** Average latency ms */
  avgLatencyMs: number;
  /** p95 latency ms */
  p95LatencyMs: number;
  /** Total tokens (input + output) */
  totalTokens: number;
  /** Per-provider breakdown */
  byProvider: Record<
    string,
    {
      requests: number;
      successRate: number;
      avgLatencyMs: number;
      tokens: number;
    }
  >;
  /** Per-model breakdown */
  byModel: Record<
    string,
    {
      requests: number;
      successRate: number;
      avgLatencyMs: number;
      tokens: number;
    }
  >;
}

// ─── Observability Manager ────────────────────────────────────

const DEFAULT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_RECORDS = 10_000;

export class ObservabilityManager {
  private usageRecords: UsageRecord[] = [];
  private costRecords: RequestCost[] = [];
  private providerErrors = new Map<string, { count: number; lastMsg?: string; lastAt?: number }>();
  private providerSuccesses = new Map<string, { count: number; lastAt?: number }>();

  // ── Cost Tracking ───────────────────────────────────────

  /**
   * Calculate and record cost for a completed request.
   */
  recordCost(params: {
    model: ModelEntry;
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens?: number;
  }): RequestCost {
    const cost = params.model.cost;
    const perMillionIn = cost?.input ?? params.model.inputCost ?? 0;
    const perMillionOut = cost?.output ?? params.model.outputCost ?? 0;
    const perMillionCacheRead = cost?.cacheRead ?? 0;

    const cachedTokens = params.cachedInputTokens ?? 0;
    const nonCachedInput = Math.max(0, params.inputTokens - cachedTokens);

    const inputCost = (nonCachedInput / 1_000_000) * perMillionIn;
    const cachedCost = (cachedTokens / 1_000_000) * perMillionCacheRead;
    const outputCost = (params.outputTokens / 1_000_000) * perMillionOut;
    const fullInputCost = (params.inputTokens / 1_000_000) * perMillionIn;
    const cacheSavings = fullInputCost - (inputCost + cachedCost);

    const record: RequestCost = {
      modelId: params.model.id,
      provider: params.model.provider,
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens,
      cachedInputTokens: cachedTokens,
      inputCost: inputCost + cachedCost,
      outputCost,
      cacheSavings: Math.max(0, cacheSavings),
      totalCost: inputCost + cachedCost + outputCost,
      timestamp: Date.now(),
    };

    this.costRecords.push(record);
    this.trimRecords();

    return record;
  }

  /**
   * Get cost summary for a time window.
   */
  getCostSummary(windowMs = DEFAULT_WINDOW_MS): CostSummary {
    const cutoff = Date.now() - windowMs;
    const records = this.costRecords.filter((r) => r.timestamp >= cutoff);

    const summary: CostSummary = {
      totalCost: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCachedTokens: 0,
      totalCacheSavings: 0,
      requestCount: records.length,
      byProvider: {},
      byModel: {},
    };

    for (const r of records) {
      summary.totalCost += r.totalCost;
      summary.totalInputTokens += r.inputTokens;
      summary.totalOutputTokens += r.outputTokens;
      summary.totalCachedTokens += r.cachedInputTokens;
      summary.totalCacheSavings += r.cacheSavings;

      // By provider
      if (!summary.byProvider[r.provider]) {
        summary.byProvider[r.provider] = { cost: 0, requests: 0, tokens: 0 };
      }
      summary.byProvider[r.provider].cost += r.totalCost;
      summary.byProvider[r.provider].requests++;
      summary.byProvider[r.provider].tokens += r.inputTokens + r.outputTokens;

      // By model
      if (!summary.byModel[r.modelId]) {
        summary.byModel[r.modelId] = { cost: 0, requests: 0, tokens: 0 };
      }
      summary.byModel[r.modelId].cost += r.totalCost;
      summary.byModel[r.modelId].requests++;
      summary.byModel[r.modelId].tokens += r.inputTokens + r.outputTokens;
    }

    return summary;
  }

  // ── Usage Recording ─────────────────────────────────────

  /**
   * Record a model usage event (success or failure).
   */
  recordUsage(record: UsageRecord): void {
    this.usageRecords.push(record);

    if (record.success) {
      const prev = this.providerSuccesses.get(record.provider) ?? { count: 0 };
      this.providerSuccesses.set(record.provider, {
        count: prev.count + 1,
        lastAt: record.timestamp,
      });
    } else {
      const prev = this.providerErrors.get(record.provider) ?? { count: 0 };
      this.providerErrors.set(record.provider, {
        count: prev.count + 1,
        lastMsg: record.errorType,
        lastAt: record.timestamp,
      });
    }

    this.trimRecords();
  }

  /**
   * Get usage summary for a time window.
   */
  getUsageSummary(windowMs = DEFAULT_WINDOW_MS): UsageSummary {
    const now = Date.now();
    const cutoff = now - windowMs;
    const records = this.usageRecords.filter((r) => r.timestamp >= cutoff);

    const summary: UsageSummary = {
      windowStart: cutoff,
      windowEnd: now,
      totalRequests: records.length,
      successRate: 0,
      avgLatencyMs: 0,
      p95LatencyMs: 0,
      totalTokens: 0,
      byProvider: {},
      byModel: {},
    };

    if (records.length === 0) return summary;

    let successCount = 0;
    let totalLatency = 0;
    const latencies: number[] = [];

    for (const r of records) {
      if (r.success) successCount++;
      totalLatency += r.latencyMs;
      latencies.push(r.latencyMs);
      summary.totalTokens += r.inputTokens + r.outputTokens;

      // By provider
      if (!summary.byProvider[r.provider]) {
        summary.byProvider[r.provider] = {
          requests: 0,
          successRate: 0,
          avgLatencyMs: 0,
          tokens: 0,
        };
      }
      const bp = summary.byProvider[r.provider];
      bp.requests++;
      bp.tokens += r.inputTokens + r.outputTokens;

      // By model
      if (!summary.byModel[r.modelId]) {
        summary.byModel[r.modelId] = { requests: 0, successRate: 0, avgLatencyMs: 0, tokens: 0 };
      }
      const bm = summary.byModel[r.modelId];
      bm.requests++;
      bm.tokens += r.inputTokens + r.outputTokens;
    }

    summary.successRate = successCount / records.length;
    summary.avgLatencyMs = totalLatency / records.length;

    // p95
    latencies.sort((a, b) => a - b);
    const p95Idx = Math.floor(latencies.length * 0.95);
    summary.p95LatencyMs = latencies[p95Idx] ?? 0;

    // Per-provider success rates and latencies
    for (const [prov, data] of Object.entries(summary.byProvider)) {
      const provRecords = records.filter((r) => r.provider === prov);
      data.successRate = provRecords.filter((r) => r.success).length / provRecords.length;
      data.avgLatencyMs = provRecords.reduce((s, r) => s + r.latencyMs, 0) / provRecords.length;
    }

    // Per-model success rates and latencies
    for (const [modelId, data] of Object.entries(summary.byModel)) {
      const modelRecords = records.filter((r) => r.modelId === modelId);
      data.successRate = modelRecords.filter((r) => r.success).length / modelRecords.length;
      data.avgLatencyMs = modelRecords.reduce((s, r) => s + r.latencyMs, 0) / modelRecords.length;
    }

    return summary;
  }

  // ── Provider Health ─────────────────────────────────────

  /**
   * Get health status for all known providers.
   */
  getProviderHealth(cooldownProviders: Set<string> = new Set()): ProviderHealth[] {
    const allProviders = new Set<string>();
    for (const r of this.usageRecords) allProviders.add(r.provider);

    const oneHourAgo = Date.now() - DEFAULT_WINDOW_MS;
    const results: ProviderHealth[] = [];

    for (const provider of allProviders) {
      const records = this.usageRecords.filter(
        (r) => r.provider === provider && r.timestamp >= oneHourAgo,
      );

      const total = records.length;
      const successes = records.filter((r) => r.success).length;
      const errors = total - successes;
      const successRate = total > 0 ? successes / total : 1;
      const avgLatency = total > 0 ? records.reduce((s, r) => s + r.latencyMs, 0) / total : 0;

      const errorInfo = this.providerErrors.get(provider);
      const successInfo = this.providerSuccesses.get(provider);
      const inCooldown = cooldownProviders.has(provider);

      let status: ProviderHealthStatus;
      if (inCooldown || successRate === 0) {
        status = 'down';
      } else if (successRate < 0.9 || avgLatency > 10_000) {
        status = 'degraded';
      } else if (total === 0) {
        status = 'unknown';
      } else {
        status = 'healthy';
      }

      results.push({
        provider,
        status,
        successRate,
        avgLatencyMs: Math.round(avgLatency),
        totalRequests: total,
        totalErrors: errors,
        inCooldown,
        lastSuccessAt: successInfo?.lastAt,
        lastErrorAt: errorInfo?.lastAt,
        lastErrorMessage: errorInfo?.lastMsg,
      });
    }

    // Sort: down first, then degraded, then healthy
    const order: Record<ProviderHealthStatus, number> = {
      down: 0,
      degraded: 1,
      unknown: 2,
      healthy: 3,
    };
    results.sort((a, b) => order[a.status] - order[b.status]);

    return results;
  }

  // ── Housekeeping ────────────────────────────────────────

  private trimRecords(): void {
    if (this.usageRecords.length > MAX_RECORDS) {
      this.usageRecords = this.usageRecords.slice(-MAX_RECORDS);
    }
    if (this.costRecords.length > MAX_RECORDS) {
      this.costRecords = this.costRecords.slice(-MAX_RECORDS);
    }
  }

  /**
   * Reset all observability data.
   */
  reset(): void {
    this.usageRecords = [];
    this.costRecords = [];
    this.providerErrors.clear();
    this.providerSuccesses.clear();
  }
}
