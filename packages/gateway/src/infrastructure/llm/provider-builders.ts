/**
 * @file packages/gateway/src/infrastructure/llm/provider-builders.ts
 * @description Factory functions that build typed ModelProviderConfig for each
 *              supported provider. Each builder returns a complete config with
 *              base URL, API type, and a curated default model catalog.
 *
 * Inspired by OpenClaw's models-config.providers.ts pattern.
 */

import type { ModelProviderConfig, ModelDefinitionConfig } from '@adytum/shared';

// ─── Helper ───────────────────────────────────────────────────

function model(
  id: string,
  name: string,
  opts: Partial<Omit<ModelDefinitionConfig, 'id' | 'name'>> = {},
): ModelDefinitionConfig {
  return {
    id,
    name,
    reasoning: opts.reasoning ?? false,
    input: opts.input ?? ['text'],
    ...(opts.cost && { cost: opts.cost }),
    ...(opts.contextWindow && { contextWindow: opts.contextWindow }),
    ...(opts.maxTokens && { maxTokens: opts.maxTokens }),
    ...(opts.compat && { compat: opts.compat }),
    ...(opts.headers && { headers: opts.headers }),
    ...(opts.api && { api: opts.api }),
  };
}

// ─── Anthropic ────────────────────────────────────────────────

export function buildAnthropicProvider(): ModelProviderConfig {
  return {
    baseUrl: 'https://api.anthropic.com',
    api: 'anthropic-messages',
    auth: 'api-key',
    authHeader: true,
    discovered: false,
    models: [
      model('claude-sonnet-4-20250514', 'Claude Sonnet 4', {
        reasoning: true,
        input: ['text', 'image'],
        contextWindow: 200_000,
        maxTokens: 16_384,
        cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
      }),
      model('claude-opus-4-20250514', 'Claude Opus 4', {
        reasoning: true,
        input: ['text', 'image'],
        contextWindow: 200_000,
        maxTokens: 32_768,
        cost: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
      }),
      model('claude-3-5-haiku-20241022', 'Claude 3.5 Haiku', {
        reasoning: false,
        input: ['text', 'image'],
        contextWindow: 200_000,
        maxTokens: 8_192,
        cost: { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
      }),
    ],
  };
}

// ─── OpenAI ───────────────────────────────────────────────────

export function buildOpenAIProvider(): ModelProviderConfig {
  return {
    baseUrl: 'https://api.openai.com/v1',
    api: 'openai-completions',
    auth: 'api-key',
    authHeader: true,
    discovered: false,
    models: [
      model('gpt-4o', 'GPT-4o', {
        reasoning: false,
        input: ['text', 'image'],
        contextWindow: 128_000,
        maxTokens: 16_384,
        cost: { input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 2.5 },
      }),
      model('gpt-4o-mini', 'GPT-4o Mini', {
        reasoning: false,
        input: ['text', 'image'],
        contextWindow: 128_000,
        maxTokens: 16_384,
        cost: { input: 0.15, output: 0.6, cacheRead: 0.075, cacheWrite: 0.15 },
      }),
      model('o3', 'o3', {
        reasoning: true,
        input: ['text', 'image'],
        contextWindow: 200_000,
        maxTokens: 100_000,
        cost: { input: 2, output: 8, cacheRead: 0.5, cacheWrite: 2 },
        compat: { maxTokensField: 'max_completion_tokens', supportsReasoningEffort: true },
      }),
      model('o4-mini', 'o4-mini', {
        reasoning: true,
        input: ['text', 'image'],
        contextWindow: 200_000,
        maxTokens: 100_000,
        cost: { input: 1.1, output: 4.4, cacheRead: 0.275, cacheWrite: 1.1 },
        compat: { maxTokensField: 'max_completion_tokens', supportsReasoningEffort: true },
      }),
    ],
  };
}

// ─── Google (Gemini) ──────────────────────────────────────────

export function buildGoogleProvider(): ModelProviderConfig {
  return {
    baseUrl: 'https://generativelanguage.googleapis.com',
    api: 'google-generative-ai',
    auth: 'api-key',
    authHeader: true,
    discovered: false,
    models: [
      model('gemini-2.5-flash', 'Gemini 2.5 Flash', {
        reasoning: true,
        input: ['text', 'image'],
        contextWindow: 1_048_576,
        maxTokens: 65_536,
        cost: { input: 0.15, output: 0.6, cacheRead: 0.0375, cacheWrite: 0.15 },
        compat: { thinkingFormat: 'google' },
      }),
      model('gemini-2.5-pro', 'Gemini 2.5 Pro', {
        reasoning: true,
        input: ['text', 'image'],
        contextWindow: 1_048_576,
        maxTokens: 65_536,
        cost: { input: 1.25, output: 10, cacheRead: 0.3125, cacheWrite: 1.25 },
        compat: { thinkingFormat: 'google' },
      }),
      model('gemini-2.0-flash', 'Gemini 2.0 Flash', {
        reasoning: false,
        input: ['text', 'image'],
        contextWindow: 1_048_576,
        maxTokens: 8_192,
        cost: { input: 0.1, output: 0.4, cacheRead: 0.025, cacheWrite: 0.1 },
      }),
    ],
  };
}

// ─── OpenRouter ───────────────────────────────────────────────

export function buildOpenRouterProvider(): ModelProviderConfig {
  return {
    baseUrl: 'https://openrouter.ai/api/v1',
    api: 'openai-completions',
    auth: 'api-key',
    authHeader: true,
    discovered: false,
    models: [
      model('anthropic/claude-sonnet-4', 'Claude Sonnet 4 (OpenRouter)', {
        reasoning: true,
        input: ['text', 'image'],
        contextWindow: 200_000,
        maxTokens: 16_384,
      }),
      model('openai/gpt-4o', 'GPT-4o (OpenRouter)', {
        reasoning: false,
        input: ['text', 'image'],
        contextWindow: 128_000,
        maxTokens: 16_384,
      }),
      model('google/gemini-2.5-flash', 'Gemini 2.5 Flash (OpenRouter)', {
        reasoning: true,
        input: ['text', 'image'],
        contextWindow: 1_048_576,
        maxTokens: 65_536,
      }),
    ],
  };
}

// ─── Groq ─────────────────────────────────────────────────────

export function buildGroqProvider(): ModelProviderConfig {
  return {
    baseUrl: 'https://api.groq.com/openai/v1',
    api: 'openai-completions',
    auth: 'api-key',
    authHeader: true,
    discovered: false,
    models: [
      model('llama-3.3-70b-versatile', 'Llama 3.3 70B', {
        reasoning: false,
        input: ['text'],
        contextWindow: 128_000,
        maxTokens: 32_768,
        cost: { input: 0.59, output: 0.79, cacheRead: 0, cacheWrite: 0 },
      }),
      model('deepseek-r1-distill-llama-70b', 'DeepSeek R1 Distill 70B', {
        reasoning: true,
        input: ['text'],
        contextWindow: 128_000,
        maxTokens: 16_384,
        cost: { input: 0.75, output: 0.99, cacheRead: 0, cacheWrite: 0 },
      }),
    ],
  };
}

// ─── Together AI ──────────────────────────────────────────────

export function buildTogetherProvider(): ModelProviderConfig {
  return {
    baseUrl: 'https://api.together.xyz/v1',
    api: 'openai-completions',
    auth: 'api-key',
    authHeader: true,
    discovered: false,
    models: [
      model('meta-llama/Llama-3.3-70B-Instruct-Turbo', 'Llama 3.3 70B Turbo', {
        reasoning: false,
        input: ['text'],
        contextWindow: 131_072,
        maxTokens: 8_192,
        cost: { input: 0.88, output: 0.88, cacheRead: 0, cacheWrite: 0 },
      }),
      model('deepseek-ai/DeepSeek-R1', 'DeepSeek R1', {
        reasoning: true,
        input: ['text'],
        contextWindow: 163_840,
        maxTokens: 16_384,
        cost: { input: 3, output: 7, cacheRead: 0, cacheWrite: 0 },
      }),
    ],
  };
}

// ─── Ollama ───────────────────────────────────────────────────

export function buildOllamaProvider(baseUrl = 'http://localhost:11434'): ModelProviderConfig {
  return {
    baseUrl: `${baseUrl.replace(/\/+$/, '')}/v1`,
    api: 'openai-completions',
    auth: 'api-key',
    authHeader: false,
    discovered: true,
    models: [],
  };
}

// ─── LM Studio ────────────────────────────────────────────────

export function buildLMStudioProvider(baseUrl = 'http://localhost:1234/v1'): ModelProviderConfig {
  return {
    baseUrl,
    api: 'openai-completions',
    auth: 'api-key',
    authHeader: false,
    discovered: true,
    models: [],
  };
}

// ─── vLLM ─────────────────────────────────────────────────────

export function buildVLLMProvider(baseUrl = 'http://127.0.0.1:8000/v1'): ModelProviderConfig {
  return {
    baseUrl,
    api: 'openai-completions',
    auth: 'api-key',
    authHeader: true,
    discovered: true,
    models: [],
  };
}

// ─── Deep Infra ───────────────────────────────────────────────

export function buildDeepInfraProvider(): ModelProviderConfig {
  return {
    baseUrl: 'https://api.deepinfra.com/v1/openai',
    api: 'openai-completions',
    auth: 'api-key',
    authHeader: true,
    discovered: false,
    models: [
      model('meta-llama/Llama-3.3-70B-Instruct', 'Llama 3.3 70B', {
        reasoning: false,
        input: ['text'],
        contextWindow: 131_072,
        maxTokens: 8_192,
        cost: { input: 0.35, output: 0.4, cacheRead: 0, cacheWrite: 0 },
      }),
    ],
  };
}

// ─── Mistral ──────────────────────────────────────────────────

export function buildMistralProvider(): ModelProviderConfig {
  return {
    baseUrl: 'https://api.mistral.ai/v1',
    api: 'openai-completions',
    auth: 'api-key',
    authHeader: true,
    discovered: false,
    models: [
      model('mistral-large-latest', 'Mistral Large', {
        reasoning: false,
        input: ['text'],
        contextWindow: 128_000,
        maxTokens: 8_192,
        cost: { input: 2, output: 6, cacheRead: 0, cacheWrite: 0 },
        compat: { requiresMistralToolIds: true },
      }),
      model('codestral-latest', 'Codestral', {
        reasoning: false,
        input: ['text'],
        contextWindow: 256_000,
        maxTokens: 8_192,
        cost: { input: 0.3, output: 0.9, cacheRead: 0, cacheWrite: 0 },
        compat: { requiresMistralToolIds: true },
      }),
    ],
  };
}

// ─── xAI (Grok) ───────────────────────────────────────────────

export function buildXAIProvider(): ModelProviderConfig {
  return {
    baseUrl: 'https://api.x.ai/v1',
    api: 'openai-completions',
    auth: 'api-key',
    authHeader: true,
    discovered: false,
    models: [
      model('grok-3', 'Grok 3', {
        reasoning: false,
        input: ['text', 'image'],
        contextWindow: 131_072,
        maxTokens: 8_192,
        cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3 },
      }),
      model('grok-3-mini', 'Grok 3 Mini', {
        reasoning: true,
        input: ['text'],
        contextWindow: 131_072,
        maxTokens: 8_192,
        cost: { input: 0.3, output: 0.5, cacheRead: 0.03, cacheWrite: 0.3 },
      }),
    ],
  };
}

// ─── Builder Registry ─────────────────────────────────────────

export type ProviderBuilderId =
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'openrouter'
  | 'groq'
  | 'together'
  | 'ollama'
  | 'lmstudio'
  | 'vllm'
  | 'deepinfra'
  | 'mistral'
  | 'xai';

type ProviderBuilder = () => ModelProviderConfig;

/** Map of provider IDs to their builder functions */
export const PROVIDER_BUILDERS: Record<ProviderBuilderId, ProviderBuilder> = {
  anthropic: buildAnthropicProvider,
  openai: buildOpenAIProvider,
  google: buildGoogleProvider,
  openrouter: buildOpenRouterProvider,
  groq: buildGroqProvider,
  together: buildTogetherProvider,
  ollama: buildOllamaProvider,
  lmstudio: buildLMStudioProvider,
  vllm: buildVLLMProvider,
  deepinfra: buildDeepInfraProvider,
  mistral: buildMistralProvider,
  xai: buildXAIProvider,
};
