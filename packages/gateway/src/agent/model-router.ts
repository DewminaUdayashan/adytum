import OpenAI from 'openai';
import type { ModelRole, TokenUsage, AdytumConfig, ModelConfig } from '@adytum/shared';
import { LLMClient, isLiteLLMAvailable } from './llm-client.js';
import { auditLogger } from '../security/audit-logger.js';
import type { ModelCatalog } from './model-catalog.js';

interface ModelRouterConfig {
  litellmBaseUrl: string;
  models: AdytumConfig['models'];
  modelChains: AdytumConfig['modelChains'];
  taskOverrides: AdytumConfig['taskOverrides'];
  modelCatalog: ModelCatalog;
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
  private modelCatalog: ModelCatalog;
  private roleMap: Map<string, ModelConfig>;
  // Map modelId -> ModelConfig for quick lookup
  private modelMap: Map<string, ModelConfig>;
  private modelChains: Partial<Record<ModelRole, string[]>>;
  private taskOverrides: Record<string, string>;
  private litellmBaseUrl: string;
  private useProxy: boolean = false;
  private initialized: boolean = false;

  constructor(config: ModelRouterConfig) {
    this.litellmBaseUrl = config.litellmBaseUrl;
    this.modelChains = config.modelChains || { thinking: [], fast: [], local: [] };
    this.taskOverrides = config.taskOverrides || {};
    this.modelCatalog = config.modelCatalog;

    this.openaiClient = new OpenAI({
      apiKey: 'not-needed',
      baseURL: config.litellmBaseUrl,
    });

    this.llmClient = new LLMClient(config.modelCatalog);

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
  private resolveChain(roleOrTask: string): ModelConfig[] {
    let chainIds: string[] = [];

    // 1. Check for task override
    if (this.taskOverrides[roleOrTask]) {
      const override = this.taskOverrides[roleOrTask];
      // The override could be a single model ID or a chain ID?
      // For now assume it points to a model ID or a role name that has a chain.
      const lookup = this.modelChains[override as ModelRole];
      if (lookup && lookup.length > 0) {
         chainIds = lookup;
      } else {
         chainIds = [override];
      }
    } 
    // 2. Check if it's a known role with a configured chain
    else {
      const lookup = this.modelChains[roleOrTask as ModelRole];
      if (lookup && lookup.length > 0) {
        chainIds = lookup;
      }
      // 3. Fallback to the single model configured for this role (Legacy/Default)
      else if (this.roleMap.has(roleOrTask)) {
         const m = this.roleMap.get(roleOrTask);
         if (m) return [m];
      }
    }

    // Resolve IDs to ModelConfig objects
    return chainIds.map(id => {
      // 1. Try fast map (config models)
      let model = this.modelMap.get(id);
      
      // 2. If not in map, try catalog (e.g. models only in catalog but referenced in chain)
      if (!model) {
        const entry = this.modelCatalog.get(id);
        if (entry) {
          model = {
            provider: entry.provider,
            model: entry.model,
            role: 'fast', // Default role for ad-hoc resolution
            baseUrl: entry.baseUrl,
            apiKey: entry.apiKey,
          } as ModelConfig;
          // Cache it
          this.modelMap.set(id, model);
        }
      }
      return model;
    }).filter(Boolean) as ModelConfig[];
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
    } = {},
  ): Promise<{
    message: OpenAI.ChatCompletionMessage;
    usage: TokenUsage;
  }> {
    if (!this.initialized) {
      await this.initialize();
    }

    const errors: Error[] = [];
    
    // Resolve the chain of models to try
    let chain = this.resolveChain(roleOrTask);
    
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
        throw new Error(`No models configured for role/task "${roleOrTask}" and no fallbacks available.`);
    }

    for (const modelConfig of chain) {
      try {
        console.log(`[ModelRouter] Trying ${modelConfig.model} for role ${roleOrTask}...`);
        if (this.useProxy) {
          return await this.chatViaProxy(modelConfig, roleOrTask as ModelRole, messages, options);
        } else {
          return await this.chatDirect(modelConfig, roleOrTask as ModelRole, messages, options);
        }
      } catch (error: any) {
        console.warn(`[ModelRouter] Model ${modelConfig.model} failed: ${error.message}`);
        errors.push(new Error(`[${modelConfig.model}] ${error.message}`));
        // Continue to next model in chain
      }
    }

    // Build a helpful error message
    const errorDetails = errors.map((e) => `  • ${e.message}`).join('\n');
    const triedModels = chain.map(m => `${m.provider}/${m.model}`).join(', ');

    throw new Error(
      `All models in chain failed for "${roleOrTask}".\n` +
      `Tried: ${triedModels}\n` +
      `Errors:\n${errorDetails}\n\n` +
      `Check your configuration, API keys, or LiteLLM proxy status.`
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
      model: modelConfig.model,
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
      model: modelConfig.model,
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
    let chain = this.resolveChain(role);
    
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
            done: chunk.choices[0]?.finish_reason !== null && chunk.choices[0]?.finish_reason !== undefined,
          };
        }
        return; // Success, exit chain loop

      } catch (error: any) {
          console.warn(`[ModelRouter] Stream model ${modelConfig.model} failed: ${error.message}`);
          errors.push(new Error(`[${modelConfig.model}] ${error.message}`));
          // Continue to next model
      }
    }

    // If we get here, all models failed
    const errorDetails = errors.map((e) => `  • ${e.message}`).join('\n');
    throw new Error(
      `All models in chain failed for streaming "${role}".\n` +
      `Errors:\n${errorDetails}`
    );
  }

  getModelForRole(role: ModelRole): string | undefined {
    const mc = this.roleMap.get(role);
    return mc?.model;
  }

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
      'o1': [15, 60],
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
    return (promptTokens / 1_000_000 * inputCost) + (completionTokens / 1_000_000 * outputCost);
  }
}
