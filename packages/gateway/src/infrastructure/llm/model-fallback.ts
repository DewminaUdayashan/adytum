/**
 * @file packages/gateway/src/infrastructure/llm/model-fallback.ts
 * @description Intelligent model fallback engine with cooldowns,
 *              cooldown probing, and context overflow detection.
 *
 * This module extends the basic retry + rate-limit logic already in
 * ModelRouter (which handles per-model rate limiting and chain iteration)
 * with more sophisticated fallback intelligence:
 *
 *   - Provider-level cooldowns (not just per-model)
 *   - Background probing of cooled-down providers
 *   - Context overflow detection and automatic model upgrade
 *   - Fallback metrics for observability
 *
 * Inspired by OpenClaw's model-fallback.ts (480 lines).
 */

import type { FallbackConfig } from '@adytum/shared';
import type { ModelEntry } from '../../domain/interfaces/model-repository.interface.js';

// ─── Types ────────────────────────────────────────────────────

export interface CooldownState {
  /** When the cooldown was set */
  startedAt: number;
  /** When the cooldown expires */
  expiresAt: number;
  /** The error that caused the cooldown */
  reason: 'rate_limit' | 'server_error' | 'auth_failure' | 'timeout';
  /** Error message */
  message?: string;
  /** Number of consecutive failures */
  failureCount: number;
}

export interface ProbeResult {
  provider: string;
  success: boolean;
  latencyMs: number;
  timestamp: number;
}

export interface FallbackMetrics {
  /** Total fallback attempts */
  totalFallbacks: number;
  /** Successful fallbacks */
  successfulFallbacks: number;
  /** Context overflow fallbacks */
  contextOverflows: number;
  /** Rate limit fallbacks */
  rateLimitFallbacks: number;
  /** Current cooldowns */
  activeCooldowns: number;
  /** Probe results (last 10) */
  recentProbes: ProbeResult[];
}

export type FallbackErrorType =
  | 'rate_limit'
  | 'context_overflow'
  | 'server_error'
  | 'auth_failure'
  | 'timeout'
  | 'unknown';

// ─── Fallback Manager ─────────────────────────────────────────

export class FallbackManager {
  private cooldowns = new Map<string, CooldownState>();
  private lastProbe = new Map<string, number>();
  private metrics: FallbackMetrics = {
    totalFallbacks: 0,
    successfulFallbacks: 0,
    contextOverflows: 0,
    rateLimitFallbacks: 0,
    activeCooldowns: 0,
    recentProbes: [],
  };
  private config: Required<FallbackConfig>;

  constructor(config?: Partial<FallbackConfig>) {
    this.config = {
      enabled: config?.enabled ?? true,
      fallbackOnRateLimit: config?.fallbackOnRateLimit ?? true,
      fallbackOnError: config?.fallbackOnError ?? false,
      fallbackOnContextOverflow: config?.fallbackOnContextOverflow ?? true,
      maxRetries: config?.maxRetries ?? 3,
      cooldownMs: config?.cooldownMs ?? 60_000,
      probeOnCooldown: config?.probeOnCooldown ?? true,
      probeIntervalMs: config?.probeIntervalMs ?? 30_000,
    };
  }

  // ── Error Classification ──────────────────────────────────

  /**
   * Classify an error to determine the fallback strategy.
   */
  classifyError(err: unknown): FallbackErrorType {
    if (!(err instanceof Error)) return 'unknown';

    const msg = err.message.toLowerCase();
    const status = (err as any)?.status ?? (err as any)?.statusCode;

    // Rate limit (429, quota, too many requests)
    if (
      status === 429 ||
      msg.includes('rate limit') ||
      msg.includes('too many requests') ||
      msg.includes('quota')
    ) {
      return 'rate_limit';
    }

    // Context overflow (token limit exceeded)
    if (
      msg.includes('context length') ||
      msg.includes('maximum context') ||
      msg.includes('token limit') ||
      msg.includes('max_tokens') ||
      msg.includes('too long') ||
      msg.includes('input too large')
    ) {
      return 'context_overflow';
    }

    // Auth failure (401, 403)
    if (
      status === 401 ||
      status === 403 ||
      msg.includes('unauthorized') ||
      msg.includes('forbidden') ||
      msg.includes('invalid api key')
    ) {
      return 'auth_failure';
    }

    // Timeout
    if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('deadline exceeded')) {
      return 'timeout';
    }

    // Server error (500+)
    if (status >= 500) {
      return 'server_error';
    }

    return 'unknown';
  }

  /**
   * Determine if an error should trigger a fallback.
   */
  shouldFallback(errorType: FallbackErrorType): boolean {
    if (!this.config.enabled) return false;

    switch (errorType) {
      case 'rate_limit':
        return this.config.fallbackOnRateLimit;
      case 'context_overflow':
        return this.config.fallbackOnContextOverflow;
      case 'server_error':
      case 'timeout':
        return this.config.fallbackOnError;
      case 'auth_failure':
        return true; // Always fallback on auth failures
      default:
        return false;
    }
  }

  // ── Cooldown Management ───────────────────────────────────

  /**
   * Put a provider into cooldown.
   */
  setCooldown(provider: string, reason: CooldownState['reason'], message?: string): void {
    const existing = this.cooldowns.get(provider);
    const failureCount = (existing?.failureCount ?? 0) + 1;

    // Exponential backoff: double cooldown for each consecutive failure (max 5min)
    const multiplier = Math.min(Math.pow(2, failureCount - 1), 5);
    const cooldownMs = this.config.cooldownMs * multiplier;

    const now = Date.now();
    this.cooldowns.set(provider, {
      startedAt: now,
      expiresAt: now + cooldownMs,
      reason,
      message,
      failureCount,
    });

    this.updateCooldownCount();
  }

  /**
   * Check if a provider is currently in cooldown.
   */
  isInCooldown(provider: string): boolean {
    const state = this.cooldowns.get(provider);
    if (!state) return false;

    if (Date.now() >= state.expiresAt) {
      this.cooldowns.delete(provider);
      this.updateCooldownCount();
      return false;
    }

    return true;
  }

  /**
   * Get cooldown state for a provider.
   */
  getCooldown(provider: string): CooldownState | undefined {
    return this.cooldowns.get(provider);
  }

  /**
   * Clear cooldown for a provider (e.g. after successful request or probe).
   */
  clearCooldown(provider: string): void {
    this.cooldowns.delete(provider);
    this.updateCooldownCount();
  }

  /**
   * Clear all cooldowns.
   */
  clearAllCooldowns(): void {
    this.cooldowns.clear();
    this.updateCooldownCount();
  }

  // ── Cooldown Probing ──────────────────────────────────────

  /**
   * Check if a cooled-down provider should be probed.
   */
  shouldProbe(provider: string): boolean {
    if (!this.config.probeOnCooldown) return false;
    if (!this.isInCooldown(provider)) return false;

    const lastProbeTime = this.lastProbe.get(provider) ?? 0;
    return Date.now() - lastProbeTime >= this.config.probeIntervalMs;
  }

  /**
   * Record a probe result.
   */
  recordProbe(provider: string, success: boolean, latencyMs: number): void {
    const now = Date.now();
    this.lastProbe.set(provider, now);

    const result: ProbeResult = { provider, success, latencyMs, timestamp: now };
    this.metrics.recentProbes.push(result);
    if (this.metrics.recentProbes.length > 10) {
      this.metrics.recentProbes.shift();
    }

    if (success) {
      this.clearCooldown(provider);
    }
  }

  // ── Context Overflow Handling ─────────────────────────────

  /**
   * Find a model with a larger context window for context overflow fallback.
   */
  findLargerContextModel(
    currentModel: ModelEntry,
    availableModels: ModelEntry[],
  ): ModelEntry | null {
    const currentWindow = currentModel.contextWindow ?? 0;

    // Filter for models with larger context windows that aren't in cooldown
    const candidates = availableModels
      .filter((m) => {
        if (m.id === currentModel.id) return false;
        if ((m.contextWindow ?? 0) <= currentWindow) return false;
        if (this.isInCooldown(m.provider)) return false;
        return true;
      })
      .sort((a, b) => {
        // Prefer same provider, then by context window (ascending — smallest upgrade)
        const sameProviderA = a.provider === currentModel.provider ? 0 : 1;
        const sameProviderB = b.provider === currentModel.provider ? 0 : 1;
        if (sameProviderA !== sameProviderB) return sameProviderA - sameProviderB;
        return (a.contextWindow ?? 0) - (b.contextWindow ?? 0);
      });

    return candidates[0] ?? null;
  }

  // ── Chain Filtering ───────────────────────────────────────

  /**
   * Filter a fallback chain to skip cooled-down providers,
   * with optional probing of cooled-down ones.
   */
  filterChain(chain: ModelEntry[]): {
    available: ModelEntry[];
    cooledDown: ModelEntry[];
    probeCandidates: ModelEntry[];
  } {
    const available: ModelEntry[] = [];
    const cooledDown: ModelEntry[] = [];
    const probeCandidates: ModelEntry[] = [];

    for (const model of chain) {
      if (this.isInCooldown(model.provider)) {
        cooledDown.push(model);
        if (this.shouldProbe(model.provider)) {
          probeCandidates.push(model);
        }
      } else {
        available.push(model);
      }
    }

    return { available, cooledDown, probeCandidates };
  }

  // ── Fallback Execution ────────────────────────────────────

  /**
   * Record a fallback attempt for metrics.
   */
  recordFallback(errorType: FallbackErrorType, success: boolean): void {
    this.metrics.totalFallbacks++;
    if (success) this.metrics.successfulFallbacks++;
    if (errorType === 'context_overflow') this.metrics.contextOverflows++;
    if (errorType === 'rate_limit') this.metrics.rateLimitFallbacks++;
  }

  /**
   * Get current fallback metrics.
   */
  getMetrics(): FallbackMetrics {
    this.updateCooldownCount();
    return { ...this.metrics };
  }

  /**
   * Get the max retries config.
   */
  getMaxRetries(): number {
    return this.config.maxRetries;
  }

  private updateCooldownCount(): void {
    // Clean expired cooldowns
    const now = Date.now();
    for (const [key, state] of this.cooldowns) {
      if (now >= state.expiresAt) {
        this.cooldowns.delete(key);
      }
    }
    this.metrics.activeCooldowns = this.cooldowns.size;
  }
}
