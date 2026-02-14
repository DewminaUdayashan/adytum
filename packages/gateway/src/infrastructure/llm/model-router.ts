/**
 * @file packages/gateway/src/infrastructure/llm/model-router.ts
 * @description Implements infrastructure adapters and external integrations.
 */

import OpenAI from 'openai';
import type { ModelRole, TokenUsage, AdytumConfig, ModelConfig } from '@adytum/shared';
import { LLMClient, isLiteLLMAvailable } from './llm-client.js';
import { auditLogger } from '../../security/audit-logger.js';
import type { ModelRepository } from '../../domain/interfaces/model-repository.interface.js';

interface ModelRouterConfig {
  litellmBaseUrl: string;
  models: AdytumConfig['models'];
  modelChains: AdytumConfig['modelChains'];
  taskOverrides: AdytumConfig['taskOverrides'];
  modelCatalog: ModelRepository;
  routing: AdytumConfig['routing'];
}

/**
 * Routes LLM requests to the correct model.
 *
 * Strategy:
 *   1. Resolve the "chain" of models to try (based on role or task override).
 *   2. Iterate through the chain:
 *      a. If LiteLLM proxy is reachable → route through it.
 *      b. Otherwise → call providers directly.
 *   3. If all models in the chain fail, throw an error.
 */
export class ModelRouter {
  private openaiClient: OpenAI;
  private llmClient: LLMClient;
  private modelCatalog: ModelRepository;
  private roleMap: Map<string, ModelConfig>;
  // Map modelId -> ModelConfig for quick lookup
  private modelMap: Map<string, ModelConfig>;
  private modelChains: Partial<Record<ModelRole, string[]>>;
  private taskOverrides: Record<string, string>;
  private litellmBaseUrl: string;
  private useProxy: boolean = false;
  private initialized: boolean = false;
  private cooldowns = new Map<string, number>(); // modelId -> timestamp until which it is cooled down
  private routing: AdytumConfig['routing'];

  constructor(config: ModelRouterConfig) {
    this.litellmBaseUrl = config.litellmBaseUrl;
    this.modelChains = config.modelChains || { thinking: [], fast: [], local: [] };
    this.taskOverrides = config.taskOverrides || {};
    this.modelCatalog = config.modelCatalog;
    this.routing = config.routing || {
      maxRetries: 5,
      fallbackOnRateLimit: true,
      fallbackOnError: false,
    };

    this.openaiClient = new OpenAI({
      apiKey: 'not-needed',
      baseURL: config.litellmBaseUrl,
    });

    // LLMClient also needs update to use ModelRepository, or we cast for now
    this.llmClient = new LLMClient(config.modelCatalog as any);

    this.roleMap = new Map();
    this.modelMap = new Map();
    for (const model of config.models) {
      this.roleMap.set(model.role, model);
      // Create a unique ID for the model (e.g. "anthropic/claude-3-5-sonnet")
      // If the ID isn't explicitly in the config, we construct it or use provider/model
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
   * Initialize: detect whether LiteLLM proxy is available.
   * Returns a status message for startup logging.
   */
  async initialize(): Promise<string> {
    this.useProxy = await isLiteLLMAvailable(this.litellmBaseUrl);
    this.initialized = true;

    if (this.useProxy) {
      return 'LiteLLM proxy connected — routing through proxy';
    }

    // Check which providers have API keys available
    const available: string[] = [];
    const missing: string[] = [];

    for (const [role, mc] of this.roleMap) {
      available.push(`${role}→${mc.provider}/${mc.model}`);
    }

    if (available.length === 0 && missing.length > 0) {
      return `No LiteLLM proxy. Missing API keys: ${missing.join(', ')}. Set them in .env`;
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
          // It maps to a role, recurse (but limit recursion?)
          // actually better to just check modelChains directly for the mapped role
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
    // 1) Check exact match in modelMap (handles "gpt-4o" if unique, or "provider/model")
    const configModel = this.modelMap.get(id);
    if (configModel) return await this.mergeCatalogDetails(id, configModel);

    // 2) If not found and looks like a provider/model, try catalog
    if (!id.includes('/') && !id.includes(':')) return null;
    if (configModel) return await this.mergeCatalogDetails(id, configModel);

    // 2) Catalog models
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
    // Prioritize catalog entries (dashboard overrides) over static config
    if (entry.apiKey) {
      updated.apiKey = entry.apiKey;
    }
    if (entry.baseUrl) {
      updated.baseUrl = entry.baseUrl;
    }
    return updated;
  }

  /**
   * Determines whether is rate limited.
   * @param modelId - Model id.
   * @returns True when is rate limited.
   */
  private isRateLimited(modelId: string): boolean {
    const until = this.cooldowns.get(modelId);
    if (!until) return false;
    if (Date.now() > until) {
      this.cooldowns.delete(modelId);
      return false;
    }
    return true;
  }

  /**
   * Sets rate limited.
   * @param modelId - Model id.
   * @param ttlMs - Ttl ms.
   */
  private setRateLimited(modelId: string, ttlMs: number = 60_000) {
    this.cooldowns.set(modelId, Date.now() + ttlMs);
  }

  /**
   * Determines whether is rate limit error.
   * @param err - Err.
   * @returns True when is rate limit error.
   */
  private isRateLimitError(err: any): boolean {
    const msg = String(err?.message || '').toLowerCase();
    return msg.includes('429') || msg.includes('rate limit') || msg.includes('rate-limit');
  }

  /**
   * Determines whether is retriable error.
   * @param err - Err.
   * @returns True when is retriable error.
   */
  private isRetriableError(err: any): boolean {
    const msg = String(err?.message || '').toLowerCase();
    return (
      msg.includes('timeout') ||
      msg.includes('timed out') ||
      msg.includes('econnreset') ||
      msg.includes('temporary') ||
      msg.includes('unavailable') ||
      msg.includes('fetch failed') ||
      msg.includes('network')
    );
  }

  /**
   * Send a chat completion request to the specified model role.
   * Falls back to other roles on failure.
   */
  async chat(
    roleOrTask: string,
    messages: OpenAI.ChatCompletionMessageParam[],
    options: {
      tools?: OpenAI.ChatCompletionTool[];
      temperature?: number;
      maxTokens?: number;
      stream?: boolean;
      fallbackRole?: ModelRole;
    } = {},
  ): Promise<{
    message: OpenAI.ChatCompletionMessage;
    usage: TokenUsage;
  }> {
    if (!this.initialized) {
      await this.initialize();
    }

    const errors: Error[] = [];
    const directModel = await this.resolveDirectModel(roleOrTask);
    const fallbackRole = options.fallbackRole;

    // Resolve the chain of models to try
    let chain = directModel ? [directModel] : await this.resolveChain(roleOrTask);

    // If user forced a model but we allow fallback on rate-limit, append role chain (deduped)
    if (directModel && this.routing.fallbackOnRateLimit && fallbackRole) {
      const fallbackChain = await this.resolveChain(fallbackRole);
      chain = [...chain, ...fallbackChain];
    }

    // Deduplicate chain by provider/model
    const seen = new Set<string>();
    chain = chain.filter((m) => {
      const id = `${m.provider}/${m.model}`;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });

    // If no chain found (e.g. invalid role), try to find ANY model as a last ditch fallback
    if (chain.length === 0) {
      // Fallback: Try 'thinking' -> 'fast' -> 'local' legacy roles
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
          console.log(
            `[ModelRouter] Trying ${modelConfig.model} (role ${roleOrTask}) attempt ${attempt}/${maxRetries}...`,
          );
          if (this.useProxy) {
            return await this.chatViaProxy(modelConfig, roleOrTask as ModelRole, messages, options);
          } else {
            return await this.chatDirect(modelConfig, roleOrTask as ModelRole, messages, options);
          }
        } catch (error: any) {
          const isRateLimited = this.isRateLimitError(error);
          if (isRateLimited) {
            this.setRateLimited(modelId);
          }

          const retriable = isRateLimited || this.isRetriableError(error);
          const canRetry = retriable && attempt < maxRetries;
          const errorMsg = `[${modelConfig.model}] ${error.message}`;

          console.warn(
            `[ModelRouter] Model ${modelConfig.model} failed (attempt ${attempt}/${maxRetries}): ${error.message}`,
          );

          if (canRetry) {
            continue;
          }

          // We are done with this model (out of retries or non-retriable)
          errors.push(new Error(errorMsg));

          const shouldFallback = isRateLimited
            ? this.routing.fallbackOnRateLimit
            : this.routing.fallbackOnError;

          if (!shouldFallback) {
            // Stop immediately if fallback is disabled for this type of error
            const errorDetails = errors.map((e) => `  • ${e.message}`).join('\n');
            const triedModels = chain.map((m) => `${m.provider}/${m.model}`).join(', ');
            throw new Error(
              `Model ${modelConfig.model} failed and fallback is disabled for role/task "${roleOrTask}".\n` +
                `Tried: ${triedModels}\n` +
                `Errors (last error was critical):\n${errorDetails}`,
            );
          }

          // Advance to next model in chain
          break;
        }
      }
    }

    // Build a helpful error message
    const errorDetails = errors.map((e) => `  • ${e.message}`).join('\n');
    const triedModels = chain.map((m) => `${m.provider}/${m.model}`).join(', ');

    throw new Error(
      `All models in chain failed for "${roleOrTask}".\n` +
        `Tried: ${triedModels}\n` +
        `Errors:\n${errorDetails}\n\n` +
        `Check your configuration, API keys, or LiteLLM proxy status.`,
    );
  }

  /** Chat via LiteLLM proxy (OpenAI SDK). */
  private async chatViaProxy(
    modelConfig: ModelConfig,
    role: ModelRole,
    messages: OpenAI.ChatCompletionMessageParam[],
    options: {
      tools?: OpenAI.ChatCompletionTool[];
      temperature?: number;
      maxTokens?: number;
    },
  ): Promise<{ message: OpenAI.ChatCompletionMessage; usage: TokenUsage }> {
    const completion = await this.openaiClient.chat.completions.create({
      model: modelConfig.model,
      messages,
      tools: options.tools,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens,
      stream: false,
    });

    const message = completion.choices[0]?.message;
    if (!message) throw new Error('No response from model');

    const usage: TokenUsage = {
      model: `${modelConfig.provider}/${modelConfig.model}`,
      role,
      promptTokens: completion.usage?.prompt_tokens ?? 0,
      completionTokens: completion.usage?.completion_tokens ?? 0,
      totalTokens: completion.usage?.total_tokens ?? 0,
      estimatedCost: this.estimateCost(
        modelConfig.model,
        completion.usage?.prompt_tokens ?? 0,
        completion.usage?.completion_tokens ?? 0,
      ),
    };

    return { message, usage };
  }

  /** Chat directly via LLMClient (no proxy). */
  private async chatDirect(
    modelConfig: ModelConfig,
    role: ModelRole,
    messages: OpenAI.ChatCompletionMessageParam[],
    options: {
      tools?: OpenAI.ChatCompletionTool[];
      temperature?: number;
      maxTokens?: number;
    },
  ): Promise<{ message: OpenAI.ChatCompletionMessage; usage: TokenUsage }> {
    const result = await this.llmClient.chat(modelConfig, {
      messages,
      tools: options.tools,
      temperature: options.temperature ?? 0.7,
      maxTokens: options.maxTokens,
    });

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

  /**
   * Stream a chat completion. Yields deltas.
   * (Only works via proxy for now — direct streaming is a Phase 3 feature.)
   */
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
    // Resolve the chain of models to try (reuse logic from chat())
    const chain = await this.resolveChain(role);

    // If no chain found, fallback
    if (chain.length === 0) {
      const legacyRoles: ModelRole[] = ['thinking', 'fast', 'local'];
      for (const r of legacyRoles) {
        const m = this.roleMap.get(r);
        if (m) chain.push(m);
      }
    }

    if (chain.length === 0) {
      throw new Error(`No models configured for role "${role}" and no fallbacks available.`);
    }

    const errors: Error[] = [];

    for (const modelConfig of chain) {
      const modelId = `${modelConfig.provider}/${modelConfig.model}`;
      if (this.isRateLimited(modelId)) {
        errors.push(new Error(`[${modelConfig.model}] skipped (recently rate-limited)`));
        continue;
      }

      try {
        console.log(`[ModelRouter] Streaming with ${modelConfig.model} for role ${role}...`);

        if (!this.useProxy) {
          // Fallback: do a non-streaming call and yield the full result
          const result = await this.chatDirect(modelConfig, role, messages, options);
          yield {
            delta: result.message.content || '',
            toolCalls: result.message.tool_calls as any,
            done: true,
          };
          return;
        }

        const stream = await this.openaiClient.chat.completions.create({
          model: modelConfig.model,
          messages,
          tools: options.tools,
          temperature: options.temperature ?? 0.7,
          max_tokens: options.maxTokens,
          stream: true,
        });

        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta;
          if (!delta) continue;

          yield {
            delta: delta.content || '',
            toolCalls: delta.tool_calls,
            done:
              chunk.choices[0]?.finish_reason !== null &&
              chunk.choices[0]?.finish_reason !== undefined,
          };
        }
        return; // Success, exit chain loop
      } catch (error: any) {
        const isRateLimited = this.isRateLimitError(error);
        if (isRateLimited) {
          this.setRateLimited(modelId);
        }

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
        // Continue to next model
      }
    }

    // If we get here, all models failed
    const errorDetails = errors.map((e) => `  • ${e.message}`).join('\n');
    throw new Error(
      `All models in chain failed for streaming "${role}".\n` + `Errors:\n${errorDetails}`,
    );
  }

  /**
   * Retrieves model for role.
   * @param role - Role.
   * @returns The get model for role result.
   */
  getModelForRole(role: ModelRole): string | undefined {
    const mc = this.roleMap.get(role);
    return mc?.model;
  }

  /**
   * Executes estimate cost.
   * @param model - Model.
   * @param promptTokens - Prompt tokens.
   * @param completionTokens - Completion tokens.
   * @returns The resulting numeric value.
   */
  private estimateCost(model: string, promptTokens: number, completionTokens: number): number {
    // Cost per million tokens: [input, output]
    const costs: Record<string, [number, number]> = {
      'claude-sonnet-4-20250514': [3, 15],
      'claude-opus-4-20250514': [15, 75],
      'claude-haiku-4-20250414': [0.8, 4],
      'claude-3-5-sonnet-20241022': [3, 15],
      'claude-3-5-haiku-20241022': [0.8, 4],
      'claude-3-opus-20240229': [15, 75],
      'gpt-4o': [2.5, 10],
      'gpt-4o-mini': [0.15, 0.6],
      'gpt-4-turbo': [10, 30],
      o1: [15, 60],
      'o3-mini': [1.1, 4.4],
      'deepseek-chat': [0.14, 0.28],
      'deepseek-reasoner': [0.55, 2.19],
      'gemini-2.0-flash': [0.1, 0.4],
      'gemini-2.0-flash-lite': [0.075, 0.3],
      'gemini-2.5-pro-preview-06-05': [1.25, 10],
      'gemini-1.5-pro': [1.25, 5],
      'gemini-1.5-flash': [0.075, 0.3],
      'llama3.3': [0, 0],
      'llama3.2': [0, 0],
    };

    const [inputCost, outputCost] = costs[model] || [0, 0];
    return (promptTokens / 1_000_000) * inputCost + (completionTokens / 1_000_000) * outputCost;
  }
}
