/**
 * @file packages/gateway/src/infrastructure/llm/provider-merge.ts
 * @description Orchestrates the full provider resolution pipeline:
 *
 *   1. Detect implicit providers from env vars → build their configs
 *   2. Run local model discovery (Ollama, LM Studio, vLLM) → populate models
 *   3. Merge implicit + explicit configs (explicit wins on conflict)
 *   4. Return a unified providers map ready for the ModelCatalog
 *
 * Inspired by OpenClaw's resolveImplicitProviders + mergeProviders pattern.
 */

import type { ModelProviderConfig, ModelDefinitionConfig, ModelsConfig } from '@adytum/shared';
import { PROVIDER_BUILDERS, type ProviderBuilderId } from './provider-builders.js';
import { detectImplicitProviders, resolveApiKeyValue } from './provider-env-resolver.js';
import { discoverLocalModels } from './provider-discovery.js';

// ─── Model Merging ────────────────────────────────────────────

/**
 * Merge two providers' model lists. Explicit models override implicit ones
 * with the same ID. Provider-level properties from explicit also override.
 */
function mergeProviderModels(
  implicit: ModelProviderConfig,
  explicit: ModelProviderConfig,
): ModelProviderConfig {
  const implicitModels = Array.isArray(implicit.models) ? implicit.models : [];
  const explicitModels = Array.isArray(explicit.models) ? explicit.models : [];

  if (implicitModels.length === 0) {
    return { ...implicit, ...explicit };
  }

  // Explicit model IDs take priority
  const seenIds = new Set(explicitModels.map((m) => m.id.toLowerCase().trim()));

  const merged: ModelDefinitionConfig[] = [
    ...explicitModels,
    ...implicitModels.filter((m) => {
      const id = m.id.toLowerCase().trim();
      if (seenIds.has(id)) return false;
      seenIds.add(id);
      return true;
    }),
  ];

  return {
    ...implicit,
    ...explicit,
    models: merged,
  };
}

/**
 * Merge two provider maps. For providers that exist in both, merge their
 * model lists. For providers only in one, include as-is.
 */
function mergeProviderMaps(
  implicit: Record<string, ModelProviderConfig>,
  explicit: Record<string, ModelProviderConfig>,
): Record<string, ModelProviderConfig> {
  const result = { ...implicit };

  for (const [key, explicitProvider] of Object.entries(explicit)) {
    const providerKey = key.trim();
    if (!providerKey) continue;

    const implicitProvider = result[providerKey];
    result[providerKey] = implicitProvider
      ? mergeProviderModels(implicitProvider, explicitProvider)
      : explicitProvider;
  }

  return result;
}

// ─── Main Resolution ──────────────────────────────────────────

export interface ResolvedProviders {
  /** Merged provider map */
  providers: Record<string, ModelProviderConfig>;
  /** Which providers were auto-detected from env vars */
  implicitProviders: string[];
  /** Which providers had models discovered at runtime */
  discoveredProviders: string[];
}

/**
 * Full provider resolution pipeline:
 * env vars → builders → discovery → merge with explicit config.
 */
export async function resolveAllProviders(params?: {
  /** Explicit provider config from adytum.config.yaml modelProviders section */
  explicitConfig?: ModelsConfig;
  /** Skip local model discovery (for faster startup in tests) */
  skipDiscovery?: boolean;
}): Promise<ResolvedProviders> {
  const mode = params?.explicitConfig?.mode ?? 'merge';
  const explicitProviders = params?.explicitConfig?.providers ?? {};

  // If mode is "replace", only use explicit config — no implicit/discovery
  if (mode === 'replace') {
    return {
      providers: explicitProviders,
      implicitProviders: [],
      discoveredProviders: [],
    };
  }

  // 1. Detect implicit providers from env vars
  const envProviders = detectImplicitProviders();
  const implicitProviders: Record<string, ModelProviderConfig> = {};
  const implicitNames: string[] = [];

  for (const [providerId, envKey] of envProviders) {
    const builder = PROVIDER_BUILDERS[providerId];
    if (!builder) continue;

    // Don't auto-add if explicitly configured (user controls it)
    if (explicitProviders[providerId]) continue;

    const config = builder();
    // Set the resolved API key (use env var name so it's re-resolved at request time)
    config.apiKey = envKey.envVar;
    implicitProviders[providerId] = config;
    implicitNames.push(providerId);
  }

  // 2. Run local model discovery (if not skipped)
  const discoveredNames: string[] = [];

  if (!params?.skipDiscovery) {
    // Determine base URLs from explicit config or defaults
    const ollamaBase = explicitProviders.ollama?.baseUrl;
    const lmStudioBase = explicitProviders.lmstudio?.baseUrl;
    const vllmBase = explicitProviders.vllm?.baseUrl;
    const vllmKey = resolveApiKeyValue(explicitProviders.vllm?.apiKey);

    const discovered = await discoverLocalModels({
      ollamaBaseUrl: ollamaBase ? ollamaBase.replace(/\/v1$/i, '') : undefined,
      lmStudioBaseUrl: lmStudioBase,
      vllmBaseUrl: vllmBase,
      vllmApiKey: vllmKey,
    });

    // Inject discovered models into their providers
    for (const [providerId, models] of discovered) {
      if (models.length === 0) continue;

      discoveredNames.push(providerId);
      const existingProvider = implicitProviders[providerId] ?? explicitProviders[providerId];

      if (existingProvider) {
        // Merge discovered models into existing provider
        const existingModels = existingProvider.models ?? [];
        const existingIds = new Set(existingModels.map((m) => m.id.toLowerCase()));
        const newModels = models.filter((m) => !existingIds.has(m.id.toLowerCase()));

        if (implicitProviders[providerId]) {
          implicitProviders[providerId] = {
            ...implicitProviders[providerId],
            models: [...existingModels, ...newModels],
          };
        }
        // Note: for explicit providers, we don't mutate them here —
        // the merge step below will combine them
      } else {
        // Create a new provider from the builder if available
        const builderId = providerId as ProviderBuilderId;
        const builder = PROVIDER_BUILDERS[builderId];
        if (builder) {
          const config = builder();
          config.models = models;
          config.discovered = true;
          implicitProviders[providerId] = config;
          if (!implicitNames.includes(providerId)) {
            implicitNames.push(providerId);
          }
        }
      }
    }
  }

  // 3. Merge implicit + explicit (explicit wins)
  const providers = mergeProviderMaps(implicitProviders, explicitProviders);

  return {
    providers,
    implicitProviders: implicitNames,
    discoveredProviders: discoveredNames,
  };
}
