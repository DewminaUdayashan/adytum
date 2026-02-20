/**
 * @file packages/gateway/src/infrastructure/llm/provider-env-resolver.ts
 * @description Detects available providers by checking environment variables.
 *
 * For each known provider, we check a prioritized list of env var names.
 * If found, we return the var name (not the value) so it can be resolved
 * at request time (supporting rotation / refresh).
 *
 * Inspired by OpenClaw's resolveEnvApiKey / resolveImplicitProviders pattern.
 */

import type { ProviderBuilderId } from './provider-builders.js';

// ─── Env Var Mapping ──────────────────────────────────────────

/** Ordered list of env vars to check per provider (first match wins). */
const PROVIDER_ENV_VARS: Record<ProviderBuilderId, string[]> = {
  anthropic: ['ANTHROPIC_API_KEY'],
  openai: ['OPENAI_API_KEY'],
  google: ['GOOGLE_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY'],
  openrouter: ['OPENROUTER_API_KEY'],
  groq: ['GROQ_API_KEY'],
  together: ['TOGETHER_API_KEY', 'TOGETHER_AI_API_KEY'],
  ollama: ['OLLAMA_API_KEY', 'OLLAMA_HOST'],
  lmstudio: ['LMSTUDIO_API_KEY'],
  vllm: ['VLLM_API_KEY'],
  deepinfra: ['DEEPINFRA_API_KEY'],
  mistral: ['MISTRAL_API_KEY'],
  xai: ['XAI_API_KEY'],
};

export interface ResolvedEnvKey {
  /** The env var name (e.g. "ANTHROPIC_API_KEY") */
  envVar: string;
  /** The resolved value */
  value: string;
  /** Human-readable source label */
  source: string;
}

/**
 * Resolve an API key for a provider from environment variables.
 */
export function resolveEnvApiKey(
  provider: ProviderBuilderId,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedEnvKey | null {
  const vars = PROVIDER_ENV_VARS[provider];
  if (!vars) return null;

  for (const envVar of vars) {
    const value = env[envVar]?.trim();
    if (value) {
      return {
        envVar,
        value,
        source: `env: ${envVar}`,
      };
    }
  }

  return null;
}

/**
 * Detect all providers that have env vars set.
 * Returns the provider IDs and their resolved keys.
 */
export function detectImplicitProviders(
  env: NodeJS.ProcessEnv = process.env,
): Map<ProviderBuilderId, ResolvedEnvKey> {
  const result = new Map<ProviderBuilderId, ResolvedEnvKey>();

  for (const provider of Object.keys(PROVIDER_ENV_VARS) as ProviderBuilderId[]) {
    const resolved = resolveEnvApiKey(provider, env);
    if (resolved) {
      result.set(provider, resolved);
    }
  }

  return result;
}

/**
 * Resolve an API key value from a string that may be:
 * 1. A literal API key
 * 2. An env var name (ALL_CAPS_WITH_UNDERSCORES)
 * 3. An env var reference like "${ENV_VAR}"
 */
export function resolveApiKeyValue(
  raw: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (!raw) return undefined;

  const trimmed = raw.trim();
  if (!trimmed) return undefined;

  // Check for ${ENV_VAR} pattern
  const braceMatch = /^\$\{([A-Z0-9_]+)\}$/.exec(trimmed);
  if (braceMatch) {
    return env[braceMatch[1]]?.trim() || undefined;
  }

  // Check if it looks like an env var name (ALL_CAPS)
  if (/^[A-Z][A-Z0-9_]*$/.test(trimmed)) {
    const envValue = env[trimmed]?.trim();
    if (envValue) return envValue;
    // Fall through — it might be a literal key that happens to be uppercase
  }

  // Treat as literal key
  return trimmed;
}
