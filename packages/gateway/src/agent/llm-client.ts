/**
 * LLM Client — Direct API support for multiple providers.
 *
 * Supports:
 *   - Anthropic (Claude) — native Messages API
 *   - OpenAI — via openai SDK
 *   - OpenRouter, Groq, Together AI — OpenAI-compatible
 *   - Ollama, LM Studio — local OpenAI-compatible
 *   - Any custom OpenAI-compatible endpoint
 *
 * When LiteLLM proxy is running, routes everything through it.
 * Otherwise, calls providers directly using env-based API keys.
 */

import type OpenAI from 'openai';
import type { ModelConfig } from '@adytum/shared';

// ─── Types ────────────────────────────────────────────────────

export interface LLMChatOptions {
  messages: OpenAI.ChatCompletionMessageParam[];
  tools?: OpenAI.ChatCompletionTool[];
  temperature?: number;
  maxTokens?: number;
}

export interface LLMChatResult {
  message: OpenAI.ChatCompletionMessage;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model: string;
}

interface ProviderEndpoint {
  baseURL: string;
  apiKey: string;
  isAnthropic: boolean;
}

// ─── Provider Registry ────────────────────────────────────────

const PROVIDER_ENV_KEYS: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GOOGLE_API_KEY',
  gemini: 'GOOGLE_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  groq: 'GROQ_API_KEY',
  together: 'TOGETHER_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  mistral: 'MISTRAL_API_KEY',
  fireworks: 'FIREWORKS_API_KEY',
  perplexity: 'PERPLEXITY_API_KEY',
  xai: 'XAI_API_KEY',
  cohere: 'COHERE_API_KEY',
};

const PROVIDER_BASE_URLS: Record<string, string> = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com/v1',
  google: 'https://generativelanguage.googleapis.com/v1beta/openai',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  openrouter: 'https://openrouter.ai/api/v1',
  groq: 'https://api.groq.com/openai/v1',
  together: 'https://api.together.xyz/v1',
  deepseek: 'https://api.deepseek.com/v1',
  mistral: 'https://api.mistral.ai/v1',
  fireworks: 'https://api.fireworks.ai/inference/v1',
  perplexity: 'https://api.perplexity.ai',
  xai: 'https://api.x.ai/v1',
  cohere: 'https://api.cohere.com/v2',
  ollama: 'http://localhost:11434/v1',
  lmstudio: 'http://localhost:1234/v1',
};

// ─── LLM Client ───────────────────────────────────────────────

export class LLMClient {
  private endpoints = new Map<string, ProviderEndpoint>();

  /**
   * Resolve the endpoint for a given model config.
   * Priority: modelConfig.apiKey → env var → local (no key needed)
   */
  resolveEndpoint(modelConfig: ModelConfig): ProviderEndpoint {
    const provider = modelConfig.provider.toLowerCase();

    // Cache lookup
    const cacheKey = `${provider}:${modelConfig.baseUrl || ''}`;
    const cached = this.endpoints.get(cacheKey);
    if (cached) return cached;

    // 1. Custom base URL from config
    const baseURL =
      modelConfig.baseUrl ||
      PROVIDER_BASE_URLS[provider] ||
      PROVIDER_BASE_URLS['openai']; // fallback to OpenAI format

    // 2. API key: explicit > env var > none (for local)
    const envKey = PROVIDER_ENV_KEYS[provider];
    const apiKey =
      modelConfig.apiKey ||
      (envKey ? process.env[envKey] || '' : '') ||
      '';

    const isAnthropic = provider === 'anthropic';

    // Local providers don't need API keys
    const localProviders = ['ollama', 'lmstudio'];

    // Validate key for cloud providers (skip if custom baseUrl is set — user knows what they're doing)
    if (!apiKey && !localProviders.includes(provider) && !modelConfig.baseUrl) {
      const envHint = envKey || `${provider.toUpperCase()}_API_KEY`;
      throw new Error(
        `No API key for provider "${provider}". ` +
        `Set ${envHint} in your .env file or pass it in adytum.config.yaml.`,
      );
    }

    const endpoint: ProviderEndpoint = { baseURL, apiKey, isAnthropic };
    this.endpoints.set(cacheKey, endpoint);
    return endpoint;
  }

  /**
   * Send a chat completion request directly to the provider.
   */
  async chat(
    modelConfig: ModelConfig,
    options: LLMChatOptions,
  ): Promise<LLMChatResult> {
    const endpoint = this.resolveEndpoint(modelConfig);

    if (endpoint.isAnthropic) {
      return this.chatAnthropic(modelConfig.model, endpoint, options);
    }

    return this.chatOpenAICompatible(modelConfig.model, endpoint, options);
  }

  // ─── Anthropic Messages API ─────────────────────────────────

  private async chatAnthropic(
    model: string,
    endpoint: ProviderEndpoint,
    options: LLMChatOptions,
  ): Promise<LLMChatResult> {
    // Extract system message
    const systemMsg = options.messages.find((m) => m.role === 'system');
    const nonSystem = options.messages.filter((m) => m.role !== 'system');

    // Convert messages to Anthropic format
    const messages = nonSystem.map((m) => this.toAnthropicMessage(m));

    const body: Record<string, unknown> = {
      model,
      messages,
      max_tokens: options.maxTokens || 4096,
    };

    if (systemMsg && typeof systemMsg.content === 'string') {
      body.system = systemMsg.content;
    }

    if (options.temperature !== undefined) {
      body.temperature = options.temperature;
    }

    // Convert OpenAI tool format → Anthropic tool format
    if (options.tools && options.tools.length > 0) {
      body.tools = options.tools.map((t) => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters,
      }));
    }

    const response = await fetch(`${endpoint.baseURL}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': endpoint.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Anthropic API error (${response.status}): ${errText}`);
    }

    const data = (await response.json()) as any;
    return this.parseAnthropicResponse(data, model);
  }

  private toAnthropicMessage(msg: OpenAI.ChatCompletionMessageParam): any {
    // Tool result message
    if (msg.role === 'tool') {
      const toolMsg = msg as OpenAI.ChatCompletionToolMessageParam;
      return {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: toolMsg.tool_call_id,
            content: typeof toolMsg.content === 'string' ? toolMsg.content : JSON.stringify(toolMsg.content),
          },
        ],
      };
    }

    // Assistant message with tool calls
    if (msg.role === 'assistant') {
      const assistantMsg = msg as OpenAI.ChatCompletionAssistantMessageParam;
      if (assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0) {
        const content: any[] = [];
        if (assistantMsg.content) {
          content.push({ type: 'text', text: assistantMsg.content });
        }
        for (const tc of assistantMsg.tool_calls) {
          content.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.function.name,
            input: JSON.parse(tc.function.arguments || '{}'),
          });
        }
        return { role: 'assistant', content };
      }
    }

    // Regular user or assistant message
    return {
      role: msg.role === 'user' ? 'user' : 'assistant',
      content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
    };
  }

  private parseAnthropicResponse(data: any, model: string): LLMChatResult {
    const textBlocks = (data.content || []).filter((b: any) => b.type === 'text');
    const toolBlocks = (data.content || []).filter((b: any) => b.type === 'tool_use');

    // Build an OpenAI-compatible message object
    const message: OpenAI.ChatCompletionMessage = {
      role: 'assistant',
      content: textBlocks.map((b: any) => b.text).join('\n') || null,
      refusal: null,
    };

    if (toolBlocks.length > 0) {
      message.tool_calls = toolBlocks.map((tb: any) => ({
        id: tb.id,
        type: 'function' as const,
        function: {
          name: tb.name,
          arguments: JSON.stringify(tb.input),
        },
      }));
    }

    return {
      message,
      usage: {
        promptTokens: data.usage?.input_tokens || 0,
        completionTokens: data.usage?.output_tokens || 0,
        totalTokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
      },
      model: data.model || model,
    };
  }

  // ─── OpenAI-Compatible API ──────────────────────────────────

  private async chatOpenAICompatible(
    model: string,
    endpoint: ProviderEndpoint,
    options: LLMChatOptions,
  ): Promise<LLMChatResult> {
    const body: Record<string, unknown> = {
      model,
      messages: options.messages,
      stream: false,
    };

    if (options.tools && options.tools.length > 0) {
      body.tools = options.tools;
      body.tool_choice = 'auto';
    }
    if (options.temperature !== undefined) body.temperature = options.temperature;
    if (options.maxTokens !== undefined) body.max_tokens = options.maxTokens;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (endpoint.apiKey) {
      headers['Authorization'] = `Bearer ${endpoint.apiKey}`;
    }

    const response = await fetch(`${endpoint.baseURL}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => 'Unknown error');
      const provider = this.identifyProvider(endpoint.baseURL);
      throw new Error(`${provider} API error (${response.status}): ${errText}`);
    }

    const data = (await response.json()) as any;
    const choice = data.choices?.[0];

    if (!choice?.message) {
      throw new Error('No response from model');
    }

    return {
      message: {
        role: 'assistant',
        content: choice.message.content || null,
        tool_calls: choice.message.tool_calls,
        refusal: null,
      },
      usage: {
        promptTokens: data.usage?.prompt_tokens || 0,
        completionTokens: data.usage?.completion_tokens || 0,
        totalTokens: data.usage?.total_tokens || 0,
      },
      model: data.model || model,
    };
  }

  private identifyProvider(baseURL: string): string {
    for (const [name, url] of Object.entries(PROVIDER_BASE_URLS)) {
      if (baseURL.includes(url) || url.includes(baseURL)) return name;
    }
    return baseURL;
  }
}

// ─── Proxy Detection ──────────────────────────────────────────

/**
 * Check if the LiteLLM proxy is reachable.
 */
export async function isLiteLLMAvailable(proxyUrl: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${proxyUrl}/health`, { signal: controller.signal });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}
