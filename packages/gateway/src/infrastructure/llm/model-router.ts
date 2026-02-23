import { logger } from '../../logger.js';
/**
 * @file packages/gateway/src/infrastructure/llm/model-router.ts
 * @description Implements infrastructure adapters and external integrations.
 */

import { singleton, inject } from 'tsyringe';
import { EventEmitter } from 'node:events';
import OpenAI from 'openai';
import type { ModelRole, TokenUsage, AdytumConfig, ModelConfig } from '@adytum/shared';
import { LLMClient } from './llm-client.js';
import { auditLogger } from '../../security/audit-logger.js';
import type { ModelRepository } from '../../domain/interfaces/model-repository.interface.js';

// Helper type for OpenAI response format compatibility
type OpenAIResponseFormat = { type: 'text' | 'json_object' };

interface ModelRouterConfig {
  models: AdytumConfig['models'];
  modelChains: AdytumConfig['modelChains'];
  taskOverrides: AdytumConfig['taskOverrides'];
  modelCatalog: ModelRepository;
  routing: AdytumConfig['routing'];
}

export type ModelRuntimeStatus = {
  state: 'rate_limited' | 'quota_exceeded';
  cooldownUntil: number;
  resetAt?: number;
  message?: string;
  updatedAt: number;
};

/**
 * Routes LLM requests to the correct model.
 *
 * Strategy:
 *   1. Resolve the "chain" of models to try (based on role or task override).
 *   2. Iterate through the chain:
 *      a. Call providers directly via LLMClient.
 *   3. If all models in the chain fail, throw an error.
 */
/** Emitted when all models in chain fail after max retries (emergency stop signal). */
export type CriticalFailurePayload = { roleOrTask: string; errors: string[] };

@singleton()
export class ModelRouter extends EventEmitter {
  private llmClient: LLMClient;
  private modelCatalog: ModelRepository;
  private roleMap: Map<string, ModelConfig>;
  // Map modelId -> ModelConfig for quick lookup
  private modelMap: Map<string, ModelConfig>;
  private modelChains: Partial<Record<ModelRole, string[]>>;
  private taskOverrides: Record<string, string>;
  private initialized: boolean = false;
  private cooldowns = new Map<string, number>(); // modelId -> timestamp until which it is cooled down
  private modelRuntimeStatus = new Map<string, ModelRuntimeStatus>();
  private routing: AdytumConfig['routing'];

  constructor(@inject('RouterConfig') config: any) {
    super();
    this.modelChains = config.modelChains || { thinking: [], fast: [], local: [] };
    this.taskOverrides = config.taskOverrides || {};
    this.modelCatalog = config.modelCatalog;
    this.routing = config.routing || {
      maxRetries: 5,
      fallbackOnRateLimit: true,
      fallbackOnError: false,
    };

    // LLMClient also needs update to use ModelRepository, or we cast for now
    this.llmClient = new LLMClient(config.modelCatalog as any);

    this.roleMap = new Map();
    this.modelMap = new Map();
    for (const model of config.models) {
      this.roleMap.set(model.role, model);
      // Create a unique ID for the model (e.g. "anthropic/claude-3-5-sonnet")
      const id = `${model.provider}/${model.model}`;
      this.modelMap.set(id, model);
      // Also map by just the model name for convenience if unique
      this.modelMap.set(model.model, model);
    }
  }

  /**
   * Update model chains at runtime (called when dashboard saves chains).
   */
  updateChains(chains: Partial<Record<ModelRole, string[]>>): void {
    this.modelChains = chains;
  }

  /**
   * Executes update routing.
   * @param routing - Routing.
   */
  updateRouting(routing: AdytumConfig['routing']): void {
    this.routing = {
      maxRetries: Math.min(Math.max(routing.maxRetries ?? 5, 1), 10),
      fallbackOnRateLimit: routing.fallbackOnRateLimit ?? true,
      fallbackOnError: routing.fallbackOnError ?? false,
    };
  }

  /**
   * Initialize.
   * Returns a status message for startup logging.
   */
  async initialize(): Promise<string> {
    this.initialized = true;

    // Check which providers have API keys available
    const available: string[] = [];
    const missing: string[] = [];

    for (const [role, mc] of this.roleMap) {
      available.push(`${role}→${mc.provider}/${mc.model}`);
    }

    if (available.length === 0 && missing.length > 0) {
      return `Missing API keys: ${missing.join(', ')}. Set them in .env`;
    }

    const parts = [`Direct API mode: ${available.join(', ')}`];
    if (missing.length > 0) {
      parts.push(`(missing: ${missing.join(', ')})`);
    }
    return parts.join(' ');
  }

  /**
   * Resolve the list of models (the chain) to use for a given request.
   */
  async resolveChain(roleOrTask: string, override?: string): Promise<ModelConfig[]> {
    const chainIds: string[] = [];

    // If override is a specific model ID
    if (override && override.includes('/')) {
      const entry = await this.modelCatalog.get(override);
      if (entry) {
        return [
          {
            provider: entry.provider,
            model: entry.model,
            role: 'fast', // or generic role
            baseUrl: entry.baseUrl,
            apiKey: entry.apiKey,
          } as ModelConfig,
        ];
      }
    }

    // 1. Build list of candidates
    // If override is a role name (e.g. "thinking")
    if (override && !override.includes('/')) {
      const chain = this.modelChains[override as ModelRole];
      if (chain) {
        chainIds.push(...chain);
      }
    } else {
      // Check if roleOrTask is a task override first
      if (this.taskOverrides[roleOrTask]) {
        const mapped = this.taskOverrides[roleOrTask];
        if (mapped.includes('/')) {
          // It maps to a specific model ID
          const entry = await this.modelCatalog.get(mapped);
          if (entry) {
            return [
              {
                provider: entry.provider,
                model: entry.model,
                role: 'fast',
                baseUrl: entry.baseUrl,
                apiKey: entry.apiKey,
              } as ModelConfig,
            ];
          }
        } else {
          // It maps to a role, recurse
          const chain = this.modelChains[mapped as ModelRole];
          if (chain) {
            chainIds.push(...chain);
          }
        }
      } else {
        // Assume it's a role
        const chain = this.modelChains[roleOrTask as ModelRole];
        if (chain) {
          chainIds.push(...chain);
        }
      }
    }

    // Resolve IDs to ModelConfig objects
    const resolved = await Promise.all(
      chainIds.map(async (id) => {
        // 1. Try fast map (config models)
        let model = this.modelMap.get(id);

        // 2. If not in map, try catalog
        if (!model) {
          const entry = await this.modelCatalog.get(id);
          if (entry) {
            model = {
              provider: entry.provider,
              model: entry.model,
              role: 'fast',
              baseUrl: entry.baseUrl,
              apiKey: entry.apiKey,
            } as ModelConfig;
            this.modelMap.set(id, model);
          }
        }

        if (model) {
          model = await this.mergeCatalogDetails(id, model);
        }
        return model;
      }),
    );

    return resolved.filter((m): m is ModelConfig => !!m);
  }

  /** Try to resolve a direct model ID (when user forces a specific model). */
  private async resolveDirectModel(id: string): Promise<ModelConfig | null> {
    const configModel = this.modelMap.get(id);
    if (configModel) return await this.mergeCatalogDetails(id, configModel);

    if (!id.includes('/') && !id.includes(':')) return null;

    const catalogEntry = await this.modelCatalog.get(id);
    if (catalogEntry) {
      const model: ModelConfig = {
        provider: catalogEntry.provider,
        model: catalogEntry.model,
        role: 'fast',
        baseUrl: catalogEntry.baseUrl,
        apiKey: catalogEntry.apiKey,
      } as ModelConfig;
      const merged = await this.mergeCatalogDetails(id, model);
      this.modelMap.set(id, merged);
      return merged;
    }

    return null;
  }

  /** Merge missing apiKey/baseUrl from catalog into a ModelConfig */
  private async mergeCatalogDetails(id: string, model: ModelConfig): Promise<ModelConfig> {
    const entry = await this.modelCatalog.get(id);
    if (!entry) return model;
    const updated: ModelConfig = { ...model };
    if (entry.apiKey) updated.apiKey = entry.apiKey;
    if (entry.baseUrl) updated.baseUrl = entry.baseUrl;
    if (entry.inputCost !== undefined) updated.inputCost = entry.inputCost;
    if (entry.outputCost !== undefined) updated.outputCost = entry.outputCost;
    return updated;
  }

  private isRateLimited(modelId: string): boolean {
    const until = this.cooldowns.get(modelId);
    if (!until) return false;
    if (Date.now() > until) {
      this.cooldowns.delete(modelId);
      this.clearCooldownStatus(modelId);
      return false;
    }
    return true;
  }

  private setRateLimited(
    modelId: string,
    details: {
      ttlMs?: number;
      resetAt?: number;
      reason?: 'rate_limited' | 'quota_exceeded';
      message?: string;
    } = {},
  ) {
    const now = Date.now();
    const ttlMs = Math.max(
      1000,
      details.ttlMs ?? (typeof details.resetAt === 'number' ? details.resetAt - now : 60_000),
    );
    const cooldownUntil = now + ttlMs;
    this.cooldowns.set(modelId, cooldownUntil);
    this.modelRuntimeStatus.set(modelId, {
      state: details.reason || 'rate_limited',
      cooldownUntil,
      resetAt: details.resetAt,
      message: details.message,
      updatedAt: now,
    });
  }

  private clearCooldownStatus(modelId: string): void {
    const status = this.modelRuntimeStatus.get(modelId);
    if (!status) return;
    if (Date.now() >= status.cooldownUntil) {
      this.modelRuntimeStatus.delete(modelId);
    }
  }

  private markModelHealthy(modelId: string): void {
    this.cooldowns.delete(modelId);
    this.modelRuntimeStatus.delete(modelId);
  }

  getModelRuntimeStatuses(): Record<string, ModelRuntimeStatus> {
    const now = Date.now();
    for (const [modelId, until] of this.cooldowns.entries()) {
      if (now >= until) {
        this.cooldowns.delete(modelId);
        this.modelRuntimeStatus.delete(modelId);
      }
    }
    return Object.fromEntries(this.modelRuntimeStatus.entries());
  }

  private isRateLimitError(err: any): boolean {
    const msg = String(err?.message || '').toLowerCase();
    const status = Number(err?.status || err?.response?.status || err?.cause?.status || 0);
    return (
      status === 429 ||
      msg.includes('429') ||
      msg.includes('rate limit') ||
      msg.includes('rate-limit') ||
      msg.includes('insufficient_quota') ||
      msg.includes('quota exceeded')
    );
  }

  private getHeaderValue(err: any, headerName: string): string | undefined {
    const target = headerName.toLowerCase();
    const headerContainers = [err?.headers, err?.response?.headers, err?.cause?.headers].filter(
      Boolean,
    );
    for (const headers of headerContainers) {
      if (typeof headers.get === 'function') {
        const value = headers.get(headerName) || headers.get(target);
        if (value) return String(value);
      }
      if (typeof headers === 'object') {
        for (const [key, value] of Object.entries(headers)) {
          if (key.toLowerCase() === target && value != null) {
            return String(value);
          }
        }
      }
    }
    return undefined;
  }

  private parseRetryDelayMs(raw: string): number | undefined {
    const value = raw.trim().toLowerCase();
    if (!value) return undefined;
    if (/^\d+(\.\d+)?$/.test(value)) {
      const n = Number(value);
      if (!Number.isFinite(n)) return undefined;
      return n <= 1000 ? Math.round(n * 1000) : Math.round(n);
    }
    const durationMatch = value.match(/^(\d+(\.\d+)?)(ms|s|m|h)$/);
    if (durationMatch) {
      const amount = Number(durationMatch[1]);
      const unit = durationMatch[3];
      if (unit === 'ms') return Math.round(amount);
      if (unit === 's') return Math.round(amount * 1000);
      if (unit === 'm') return Math.round(amount * 60_000);
      if (unit === 'h') return Math.round(amount * 3_600_000);
    }
    const dateMs = Date.parse(raw);
    if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - Date.now());
    return undefined;
  }

  private extractResetAt(err: any): number | undefined {
    const now = Date.now();
    const headerNames = [
      'retry-after',
      'retry-after-ms',
      'x-ratelimit-reset',
      'x-ratelimit-reset-requests',
      'x-ratelimit-reset-tokens',
      'ratelimit-reset',
    ];
    for (const name of headerNames) {
      const raw = this.getHeaderValue(err, name);
      if (!raw) continue;
      const delayMs = this.parseRetryDelayMs(raw);
      if (delayMs !== undefined) {
        if (name === 'retry-after-ms') return now + delayMs;
        return now + Math.max(1000, delayMs);
      }
      const numeric = Number(raw);
      if (!Number.isFinite(numeric)) continue;
      if (numeric > 1_000_000_000_000) return numeric;
      if (numeric > 1_000_000_000) return numeric * 1000;
      if (numeric > 0) return now + numeric * 1000;
    }
    const message = String(err?.message || '');
    const inMatch = message.match(
      /(?:try again|retry|reset)[^\n]*?in\s+(\d+(\.\d+)?)\s*(ms|milliseconds?|s|sec|seconds?|m|min|minutes?|h|hr|hours?)/i,
    );
    if (inMatch) {
      const amount = Number(inMatch[1]);
      const unit = inMatch[3].toLowerCase();
      let delayMs = 0;
      if (unit.startsWith('ms')) delayMs = amount;
      else if (unit.startsWith('s')) delayMs = amount * 1000;
      else if (unit.startsWith('m')) delayMs = amount * 60_000;
      else if (unit.startsWith('h')) delayMs = amount * 3_600_000;
      if (delayMs > 0) return now + Math.round(delayMs);
    }
    return undefined;
  }

  private buildRateLimitState(err: any): {
    reason: 'rate_limited' | 'quota_exceeded';
    resetAt?: number;
    ttlMs: number;
    message: string;
  } {
    const message = String(err?.message || 'Rate limited');
    const lower = message.toLowerCase();
    const reason =
      lower.includes('insufficient_quota') ||
      (lower.includes('quota') &&
        (lower.includes('exceed') || lower.includes('insufficient') || lower.includes('credit')))
        ? 'quota_exceeded'
        : 'rate_limited';
    const resetAt = this.extractResetAt(err);
    const ttlMs = Math.max(1000, (resetAt ? resetAt - Date.now() : 60_000) || 60_000);
    return { reason, resetAt, ttlMs, message };
  }

  private isRetriableError(err: any): boolean {
    const msg = String(err?.message || '').toLowerCase();
    return (
      msg.includes('timeout') ||
      msg.includes('timed out') ||
      msg.includes('econnreset') ||
      msg.includes('temporary') ||
      msg.includes('unavailable') ||
      msg.includes('fetch failed') ||
      msg.includes('network') ||
      msg.includes('empty response')
    );
  }

  async chat(
    roleOrTask: string,
    messages: OpenAI.ChatCompletionMessageParam[],
    options: {
      tools?: OpenAI.ChatCompletionTool[];
      temperature?: number;
      maxTokens?: number;
      stream?: boolean;
      fallbackRole?: ModelRole;
      response_format?: OpenAIResponseFormat;
      tier?: 1 | 2 | 3;
    } = {},
  ): Promise<{
    message: OpenAI.ChatCompletionMessage;
    usage: TokenUsage;
  }> {
    if (!this.initialized) await this.initialize();
    const errors: Error[] = [];
    const directModel = await this.resolveDirectModel(roleOrTask);
    const fallbackRole = options.fallbackRole;
    let chain = directModel ? [directModel] : await this.resolveChain(roleOrTask);
    if (directModel && this.routing.fallbackOnRateLimit && fallbackRole) {
      const fallbackChain = await this.resolveChain(fallbackRole);
      chain = [...chain, ...fallbackChain];
    }
    const seen = new Set<string>();
    chain = chain.filter((m) => {
      const id = `${m.provider}/${m.model}`;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    const tier = options.tier;
    if (tier === 3) chain = chain.slice(0, 3);
    else if (tier === 1 || tier === 2) chain = chain.slice(0, 5);
    if (chain.length === 0) {
      const legacyRoles: ModelRole[] = ['thinking', 'fast', 'local'];
      for (const r of legacyRoles) {
        const m = this.roleMap.get(r);
        if (m) chain.push(m);
      }
    }
    if (chain.length === 0) {
      throw new Error(
        `No models configured for role/task "${roleOrTask}" and no fallbacks available.`,
      );
    }
    const maxRetries = Math.min(Math.max(this.routing.maxRetries ?? 5, 1), 10);
    for (const modelConfig of chain) {
      const modelId = `${modelConfig.provider}/${modelConfig.model}`;
      if (this.isRateLimited(modelId)) {
        errors.push(new Error(`[${modelConfig.model}] skipped (recently rate-limited)`));
        continue;
      }
      let attempt = 0;
      while (attempt < maxRetries) {
        attempt++;
        try {
          logger.debug(
            `[ModelRouter] Trying ${modelConfig.model} (role ${roleOrTask}) attempt ${attempt}/${maxRetries}...`,
          );
          this.markModelHealthy(modelId);
          return await this.chatDirect(modelConfig, roleOrTask as ModelRole, messages, options);
        } catch (error: any) {
          const isRateLimited = this.isRateLimitError(error);
          if (isRateLimited) this.setRateLimited(modelId, this.buildRateLimitState(error));
          const retriable = isRateLimited || this.isRetriableError(error);
          const canRetry = retriable && attempt < maxRetries;
          const errorMsg = `[${modelConfig.model}] ${error.message}`;
          console.warn(
            `[ModelRouter] Model ${modelConfig.model} failed (attempt ${attempt}/${maxRetries}): ${error.message}`,
          );
          if (canRetry) continue;
          errors.push(new Error(errorMsg));
          const shouldFallback = isRateLimited
            ? this.routing.fallbackOnRateLimit
            : this.routing.fallbackOnError;
          if (!shouldFallback) {
            const errorDetails = errors.map((e) => `  • ${e.message}`).join('\n');
            const triedModels = chain.map((m) => `${m.provider}/${m.model}`).join(', ');
            throw new Error(
              `Model ${modelConfig.model} failed and fallback is disabled for role/task "${roleOrTask}".\n` +
                `Tried: ${triedModels}\n` +
                `Errors (last error was critical):\n${errorDetails}`,
            );
          }
          break;
        }
      }
    }
    const errorDetails = errors.map((e) => `  • ${e.message}`).join('\n');
    const triedModels = chain.map((m) => `${m.provider}/${m.model}`).join(', ');
    this.emit('critical_failure', {
      roleOrTask,
      errors: errors.map((e) => e.message),
    } as CriticalFailurePayload);
    throw new Error(
      `All models in chain failed for "${roleOrTask}".\n` +
        `Tried: ${triedModels}\n` +
        `Errors:\n${errorDetails}\n\n` +
        `Check your configuration, API keys, etc.`,
    );
  }

  private async chatDirect(
    modelConfig: ModelConfig,
    role: ModelRole,
    messages: OpenAI.ChatCompletionMessageParam[],
    options: {
      tools?: OpenAI.ChatCompletionTool[];
      temperature?: number;
      maxTokens?: number;
      response_format?: OpenAIResponseFormat;
    },
  ): Promise<{ message: OpenAI.ChatCompletionMessage; usage: TokenUsage }> {
    const result = await this.llmClient.chat(modelConfig, {
      messages,
      tools: options.tools,
      temperature: options.temperature ?? 0.7,
      maxTokens: options.maxTokens,
      response_format: options.response_format,
    });
    const hasContent = (result.message.content || '').trim().length > 0;
    const hasTools = (result.message.tool_calls || []).length > 0;
    if (!hasContent && !hasTools)
      throw new Error(`[${modelConfig.model}] Empty response from model (no content, no tools)`);
    const usage: TokenUsage = {
      model: `${modelConfig.provider}/${modelConfig.model}`,
      role,
      promptTokens: result.usage.promptTokens,
      completionTokens: result.usage.completionTokens,
      totalTokens: result.usage.totalTokens,
      estimatedCost: this.estimateCost(
        modelConfig.model,
        result.usage.promptTokens,
        result.usage.completionTokens,
      ),
    };
    return { message: result.message, usage };
  }

  async *chatStream(
    role: ModelRole,
    messages: OpenAI.ChatCompletionMessageParam[],
    options: {
      tools?: OpenAI.ChatCompletionTool[];
      temperature?: number;
      maxTokens?: number;
    } = {},
  ): AsyncGenerator<{
    delta: string;
    toolCalls?: OpenAI.ChatCompletionChunk.Choice.Delta.ToolCall[];
    done: boolean;
  }> {
    const chain = await this.resolveChain(role);
    if (chain.length === 0) {
      const legacyRoles: ModelRole[] = ['thinking', 'fast', 'local'];
      for (const r of legacyRoles) {
        const m = this.roleMap.get(r);
        if (m) chain.push(m);
      }
    }
    if (chain.length === 0)
      throw new Error(`No models configured for role "${role}" and no fallbacks available.`);
    const errors: Error[] = [];
    for (const modelConfig of chain) {
      const modelId = `${modelConfig.provider}/${modelConfig.model}`;
      if (this.isRateLimited(modelId)) {
        errors.push(new Error(`[${modelConfig.model}] skipped (recently rate-limited)`));
        continue;
      }
      try {
        logger.debug(`[ModelRouter] Streaming with ${modelConfig.model} for role ${role}...`);
        this.markModelHealthy(modelId);
        const result = await this.chatDirect(modelConfig, role, messages, options);
        yield {
          delta: result.message.content || '',
          toolCalls: result.message.tool_calls as any,
          done: true,
        };
        return;
      } catch (error: any) {
        const isRateLimited = this.isRateLimitError(error);
        if (isRateLimited) this.setRateLimited(modelId, this.buildRateLimitState(error));
        const errorMsg = `[${modelConfig.model}] ${error.message}`;
        console.warn(`[ModelRouter] Stream model ${modelConfig.model} failed: ${error.message}`);
        errors.push(new Error(errorMsg));
        const shouldFallback = isRateLimited
          ? this.routing.fallbackOnRateLimit
          : this.routing.fallbackOnError;
        if (!shouldFallback) {
          const errorDetails = errors.map((e) => `  • ${e.message}`).join('\n');
          throw new Error(
            `Model ${modelConfig.model} failed and fallback is disabled for streaming "${role}".\n` +
              `Errors (last error was critical):\n${errorDetails}`,
          );
        }
      }
    }
    const errorDetails = errors.map((e) => `  • ${e.message}`).join('\n');
    throw new Error(
      `All models in chain failed for streaming "${role}".\n` + `Errors:\n${errorDetails}`,
    );
  }

  getModelForRole(role: ModelRole): string | undefined {
    const mc = this.roleMap.get(role);
    return mc?.model;
  }

  getModelMap(): Map<string, ModelConfig> {
    return this.modelMap;
  }

  private estimateCost(model: string, promptTokens: number, completionTokens: number): number {
    const config = this.modelMap.get(model);
    if (!config) return 0;
    const inputCost = config.inputCost || 0;
    const outputCost = config.outputCost || 0;
    return (promptTokens / 1_000_000) * inputCost + (completionTokens / 1_000_000) * outputCost;
  }
}
