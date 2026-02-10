import OpenAI from 'openai';
import type { ModelRole, TokenUsage, AdytumConfig } from '@adytum/shared';
import { auditLogger } from '../security/audit-logger.js';

interface ModelRouterConfig {
  litellmBaseUrl: string;
  models: AdytumConfig['models'];
}

/**
 * Routes LLM requests to the correct model via LiteLLM proxy.
 * Supports thinking/fast/local roles with automatic fallback.
 */
export class ModelRouter {
  private client: OpenAI;
  private roleMap: Map<string, string>;
  private fallbackChain: ModelRole[] = ['thinking', 'fast', 'local'];

  constructor(config: ModelRouterConfig) {
    this.client = new OpenAI({
      apiKey: 'not-needed', // LiteLLM handles auth
      baseURL: config.litellmBaseUrl,
    });

    this.roleMap = new Map();
    for (const model of config.models) {
      this.roleMap.set(model.role, model.model);
    }
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
    const errors: Error[] = [];

    // Try the requested role first, then fall back
    const rolesToTry = [role, ...this.fallbackChain.filter((r) => r !== role)];

    for (const tryRole of rolesToTry) {
      const model = this.roleMap.get(tryRole);
      if (!model) continue;

      try {
        const completion = await this.client.chat.completions.create({
          model,
          messages,
          tools: options.tools,
          temperature: options.temperature ?? 0.7,
          max_tokens: options.maxTokens,
          stream: false,
        });

        const message = completion.choices[0]?.message;
        if (!message) throw new Error('No response from model');

        const usage: TokenUsage = {
          model,
          role: tryRole as ModelRole,
          promptTokens: completion.usage?.prompt_tokens ?? 0,
          completionTokens: completion.usage?.completion_tokens ?? 0,
          totalTokens: completion.usage?.total_tokens ?? 0,
          estimatedCost: this.estimateCost(
            model,
            completion.usage?.prompt_tokens ?? 0,
            completion.usage?.completion_tokens ?? 0,
          ),
        };

        return { message, usage };
      } catch (error: any) {
        errors.push(error);
        // Continue to next fallback
      }
    }

    throw new Error(
      `All models failed. Errors:\n${errors.map((e) => e.message).join('\n')}`,
    );
  }

  /**
   * Stream a chat completion. Yields deltas.
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
    const model = this.roleMap.get(role);
    if (!model) throw new Error(`No model configured for role: ${role}`);

    const stream = await this.client.chat.completions.create({
      model,
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
    return this.roleMap.get(role);
  }

  private estimateCost(model: string, promptTokens: number, completionTokens: number): number {
    // Rough cost estimates per million tokens
    const costs: Record<string, [number, number]> = {
      'claude-sonnet-4-20250514': [3, 15],
      'claude-opus-4-20250514': [15, 75],
      'claude-haiku-4-20250514': [0.8, 4],
      'gpt-4o': [2.5, 10],
      'gpt-4o-mini': [0.15, 0.6],
    };

    const [inputCost, outputCost] = costs[model] || [0, 0];
    return (promptTokens / 1_000_000 * inputCost) + (completionTokens / 1_000_000 * outputCost);
  }
}
