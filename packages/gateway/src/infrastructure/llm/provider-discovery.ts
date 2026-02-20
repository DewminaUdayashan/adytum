/**
 * @file packages/gateway/src/infrastructure/llm/provider-discovery.ts
 * @description Auto-discovers models from local and remote providers at runtime.
 *
 * Supports: Ollama, LM Studio, vLLM (local),
 *           HuggingFace Inference, OpenRouter catalog (remote).
 */

import type { ModelDefinitionConfig } from '@adytum/shared';

// ─── Types ────────────────────────────────────────────────────

interface OllamaModel {
  name: string;
  modified_at: string;
  size: number;
  digest: string;
  details?: { family?: string; parameter_size?: string };
}

interface OllamaTagsResponse {
  models: OllamaModel[];
}

interface OpenAIModelsResponse {
  data?: Array<{ id?: string }>;
}

// ─── Discovery Functions ──────────────────────────────────────

const DEFAULT_TIMEOUT = 3000;

/**
 * Discover Ollama models from its native API.
 */
export async function discoverOllamaModels(
  baseUrl = 'http://localhost:11434',
  timeoutMs = DEFAULT_TIMEOUT,
): Promise<ModelDefinitionConfig[]> {
  try {
    const apiBase = baseUrl.replace(/\/+$/, '').replace(/\/v1$/i, '');
    const res = await fetch(`${apiBase}/api/tags`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return [];

    const data = (await res.json()) as OllamaTagsResponse;
    if (!data.models?.length) return [];

    return data.models.map((m) => {
      const id = m.name;
      const lower = id.toLowerCase();
      const isReasoning =
        lower.includes('r1') || lower.includes('reasoning') || lower.includes('think');
      return {
        id,
        name: id,
        reasoning: isReasoning,
        input: ['text'] as const,
        contextWindow: 128_000,
        maxTokens: 8_192,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      };
    });
  } catch {
    return [];
  }
}

/**
 * Discover models from an OpenAI-compatible /v1/models endpoint.
 * Works for: LM Studio, vLLM, LocalAI, etc.
 */
export async function discoverOpenAICompatModels(
  baseUrl: string,
  apiKey?: string,
  timeoutMs = DEFAULT_TIMEOUT,
): Promise<ModelDefinitionConfig[]> {
  try {
    const trimmedUrl = baseUrl.trim().replace(/\/+$/, '');
    const url = `${trimmedUrl}/models`;
    const headers: Record<string, string> = {};
    if (apiKey?.trim()) {
      headers['Authorization'] = `Bearer ${apiKey.trim()}`;
    }

    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return [];

    const data = (await res.json()) as OpenAIModelsResponse;
    const models = data.data ?? [];
    if (!models.length) return [];

    return models
      .map((m) => (typeof m.id === 'string' ? m.id.trim() : ''))
      .filter(Boolean)
      .map((id) => {
        const lower = id.toLowerCase();
        const isReasoning =
          lower.includes('r1') || lower.includes('reasoning') || lower.includes('think');
        return {
          id,
          name: id,
          reasoning: isReasoning,
          input: ['text'] as const,
          contextWindow: 128_000,
          maxTokens: 8_192,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        };
      });
  } catch {
    return [];
  }
}

/**
 * Run all local discovery scans. Returns a map of providerId → discovered models.
 */
export async function discoverLocalModels(params?: {
  ollamaBaseUrl?: string;
  lmStudioBaseUrl?: string;
  vllmBaseUrl?: string;
  vllmApiKey?: string;
  timeoutMs?: number;
}): Promise<Map<string, ModelDefinitionConfig[]>> {
  const timeout = params?.timeoutMs ?? DEFAULT_TIMEOUT;
  const result = new Map<string, ModelDefinitionConfig[]>();

  // Run all scans in parallel
  const [ollamaModels, lmStudioModels, vllmModels] = await Promise.all([
    discoverOllamaModels(params?.ollamaBaseUrl, timeout),
    discoverOpenAICompatModels(
      params?.lmStudioBaseUrl ?? 'http://localhost:1234/v1',
      undefined,
      timeout,
    ),
    params?.vllmBaseUrl
      ? discoverOpenAICompatModels(params.vllmBaseUrl, params.vllmApiKey, timeout)
      : Promise.resolve([]),
  ]);

  if (ollamaModels.length > 0) result.set('ollama', ollamaModels);
  if (lmStudioModels.length > 0) result.set('lmstudio', lmStudioModels);
  if (vllmModels.length > 0) result.set('vllm', vllmModels);

  return result;
}
