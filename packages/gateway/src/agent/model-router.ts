import OpenAI from 'openai';
import type { ModelRole, TokenUsage, AdytumConfig, ModelConfig } from '@adytum/shared';
import { LLMClient, isLiteLLMAvailable } from './llm-client.js';
import { auditLogger } from '../security/audit-logger.js';

interface ModelRouterConfig {
  litellmBaseUrl: string;
  models: AdytumConfig['models'];
}

/**
 * Routes LLM requests to the correct model.
 *
 * Strategy:
 *   1. If LiteLLM proxy is reachable → route everything through it (OpenAI SDK).
 *   2. Otherwise → call providers directly via LLMClient.
 *
 * Supports thinking/fast/local roles with automatic fallback.
 */
export class ModelRouter {
  private openaiClient: OpenAI;
  private llmClient: LLMClient;
  private roleMap: Map<string, ModelConfig>;
  private fallbackChain: ModelRole[] = ['thinking', 'fast', 'local'];
  private litellmBaseUrl: string;
  private useProxy: boolean = false;
  private initialized: boolean = false;

  constructor(config: ModelRouterConfig) {
    this.litellmBaseUrl = config.litellmBaseUrl;

    this.openaiClient = new OpenAI({
      apiKey: 'not-needed',
      baseURL: config.litellmBaseUrl,
    });

    this.llmClient = new LLMClient();

    this.roleMap = new Map();
    for (const model of config.models) {
      this.roleMap.set(model.role, model);
    }
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
      try {
        this.llmClient.resolveEndpoint(mc);
        available.push(`${role}→${mc.provider}/${mc.model}`);
      } catch {
        missing.push(`${role}→${mc.provider} (no API key)`);
      }
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
   * Send a chat completion request to the specified model role.
   * Falls back to other roles on failure.
   */
  async chat(
    role: ModelRole,
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

    // Try the requested role first, then fall back
    const rolesToTry = [role, ...this.fallbackChain.filter((r) => r !== role)];

    for (const tryRole of rolesToTry) {
      const modelConfig = this.roleMap.get(tryRole);
      if (!modelConfig) continue;

      try {
        if (this.useProxy) {
          return await this.chatViaProxy(modelConfig, tryRole, messages, options);
        } else {
          return await this.chatDirect(modelConfig, tryRole, messages, options);
        }
      } catch (error: any) {
        errors.push(error);
        // Continue to next fallback
      }
    }

    // Build a helpful error message
    const errorDetails = errors.map((e) => `  • ${e.message}`).join('\n');
    const configuredModels = Array.from(this.roleMap.entries())
      .map(([r, mc]) => `${r}→${mc.provider}/${mc.model}`)
      .join(', ');

    throw new Error(
      `All models failed.\n` +
      `Configured: ${configuredModels || 'none'}\n` +
      `Errors:\n${errorDetails}\n\n` +
      `Troubleshooting:\n` +
      `  1. Check your API key is set in .env (e.g. ANTHROPIC_API_KEY=sk-ant-...)\n` +
      `  2. Or start the LiteLLM proxy: docker compose up -d litellm\n` +
      `  3. Or run a local model: ollama run llama3.2`,
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
    const modelConfig = this.roleMap.get(role);
    if (!modelConfig) throw new Error(`No model configured for role: ${role}`);

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
