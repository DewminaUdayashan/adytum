/**
 * @file packages/shared/src/types/models.ts
 * @description Comprehensive model connectivity type system.
 *
 * Inspired by OpenClaw's architecture, this module defines the full type
 * hierarchy for model providers, definitions, compatibility, and configuration.
 *
 * All types are additive — the original ModelConfigSchema / ModelRoleSchema
 * in types.ts remain unchanged for backward compatibility.
 */

import { z } from 'zod';

// ─── Model API Protocol Types ─────────────────────────────────
// Each API type represents a distinct wire protocol / request format.

export const ModelApiSchema = z.enum([
  'openai-completions', // Standard OpenAI chat completions (also: Groq, Together, OpenRouter, vLLM)
  'openai-responses', //   OpenAI Responses API (newer)
  'anthropic-messages', // Anthropic Messages API (also: MiniMax Anthropic compat)
  'google-generative-ai', // Google Generative AI / Gemini
  'ollama', //              Ollama native + OpenAI compat layer
  'bedrock-converse-stream', // AWS Bedrock Converse API
  'litellm', //             LiteLLM proxy (our existing proxy)
]);
export type ModelApi = z.infer<typeof ModelApiSchema>;

// ─── Model Compatibility Config ───────────────────────────────
// Per-model quirks that affect how we build requests / parse responses.

export const ModelCompatConfigSchema = z.object({
  /** Whether this model supports the OpenAI store parameter */
  supportsStore: z.boolean().optional(),
  /** Whether this model supports the developer role (OpenAI only) */
  supportsDeveloperRole: z.boolean().optional(),
  /** Whether reasoning_effort / thinking budget is supported */
  supportsReasoningEffort: z.boolean().optional(),
  /** Whether usage stats arrive in streaming chunks (vs final only) */
  supportsUsageInStreaming: z.boolean().optional(),
  /** Whether strict JSON mode in tool schemas is supported */
  supportsStrictMode: z.boolean().optional(),
  /** Which field name to use for max tokens */
  maxTokensField: z.enum(['max_completion_tokens', 'max_tokens']).optional(),
  /** How thinking/reasoning output is formatted */
  thinkingFormat: z.enum(['openai', 'anthropic', 'google', 'qwen']).optional(),
  /** Whether tool_result blocks require a name field */
  requiresToolResultName: z.boolean().optional(),
  /** Whether an assistant message is required after tool_result */
  requiresAssistantAfterToolResult: z.boolean().optional(),
  /** Whether thinking output must be plain text (no structured blocks) */
  requiresThinkingAsText: z.boolean().optional(),
  /** Whether Mistral-style tool call IDs are required */
  requiresMistralToolIds: z.boolean().optional(),
});
export type ModelCompatConfig = z.infer<typeof ModelCompatConfigSchema>;

// ─── Model Cost Config ────────────────────────────────────────
// Cost per 1M tokens (dollars). Used for usage tracking & budgeting.

export const ModelCostConfigSchema = z.object({
  /** Cost per 1M input tokens */
  input: z.number().min(0),
  /** Cost per 1M output tokens */
  output: z.number().min(0),
  /** Cost per 1M cached-read tokens (prompt caching) */
  cacheRead: z.number().min(0).default(0),
  /** Cost per 1M cache-write tokens */
  cacheWrite: z.number().min(0).default(0),
});
export type ModelCostConfig = z.infer<typeof ModelCostConfigSchema>;

// ─── Model Input Types ────────────────────────────────────────

export const ModelInputTypeSchema = z.enum(['text', 'image', 'audio', 'video']);
export type ModelInputType = z.infer<typeof ModelInputTypeSchema>;

// ─── Model Definition Config ──────────────────────────────────
// A single model within a provider. This is the richest model descriptor.

export const ModelDefinitionConfigSchema = z.object({
  /** Model identifier (e.g. "claude-sonnet-4", "gpt-4o") */
  id: z.string(),
  /** Human-friendly display name */
  name: z.string(),
  /** Override API protocol (inherits from provider if not set) */
  api: ModelApiSchema.optional(),
  /** Whether this model supports extended thinking / chain-of-thought */
  reasoning: z.boolean().default(false),
  /** Supported input modalities */
  input: z.array(ModelInputTypeSchema).default(['text']),
  /** Token cost information */
  cost: ModelCostConfigSchema.optional(),
  /** Maximum context window size in tokens */
  contextWindow: z.number().int().positive().optional(),
  /** Maximum output tokens per request */
  maxTokens: z.number().int().positive().optional(),
  /** Custom headers to send with requests to this model */
  headers: z.record(z.string(), z.string()).optional(),
  /** Per-model compatibility overrides */
  compat: ModelCompatConfigSchema.optional(),
});
export type ModelDefinitionConfig = z.infer<typeof ModelDefinitionConfigSchema>;

// ─── Provider Auth Mode ───────────────────────────────────────

export const ModelProviderAuthModeSchema = z.enum([
  'api-key', // Standard API key (header or query param)
  'oauth', //   OAuth2 token exchange (e.g. GitHub Copilot, Qwen Portal)
  'token', //   Bearer token from auth profile store
  'aws-sdk', // AWS credential chain (profile, env, IAM role)
]);
export type ModelProviderAuthMode = z.infer<typeof ModelProviderAuthModeSchema>;

// ─── Model Provider Config ────────────────────────────────────
// A provider groups models that share baseUrl + auth.

export const ModelProviderConfigSchema = z.object({
  /** API base URL for this provider */
  baseUrl: z.string(),
  /** API key — can be a literal key or env var name (e.g. "ANTHROPIC_API_KEY") */
  apiKey: z.string().optional(),
  /** Auth mode override (default: "api-key") */
  auth: ModelProviderAuthModeSchema.default('api-key'),
  /** Default API protocol for models in this provider */
  api: ModelApiSchema.optional(),
  /** Custom headers for all requests to this provider */
  headers: z.record(z.string(), z.string()).optional(),
  /** Whether to use Authorization header (vs x-api-key, etc.) */
  authHeader: z.boolean().default(true),
  /** Models offered by this provider */
  models: z.array(ModelDefinitionConfigSchema).default([]),
  /** Whether this provider's models were auto-discovered (vs explicit config) */
  discovered: z.boolean().default(false),
});
export type ModelProviderConfig = z.infer<typeof ModelProviderConfigSchema>;

// ─── Models Top-Level Config ──────────────────────────────────
// The new `models` section in adytum.config.yaml.

export const ModelsConfigSchema = z.object({
  /**
   * How to combine auto-discovered providers with explicit config:
   *   - "merge": auto-discovered + explicit (explicit wins on conflict)
   *   - "replace": only use explicit config, ignore discovery
   */
  mode: z.enum(['merge', 'replace']).default('merge'),
  /** Provider configurations keyed by provider ID */
  providers: z.record(z.string(), ModelProviderConfigSchema).default({}),
  /** User-defined model aliases (e.g. { "sonnet": "anthropic/claude-sonnet-4" }) */
  aliases: z.record(z.string(), z.string()).default({}),
  /** Default model selection */
  defaults: z
    .object({
      /** Primary model reference ("provider/model") */
      primary: z.string().optional(),
      /** Ordered fallback model refs */
      fallbacks: z.array(z.string()).default([]),
    })
    .optional(),
});
export type ModelsConfig = z.infer<typeof ModelsConfigSchema>;

// ─── Model Reference ──────────────────────────────────────────
// A parsed "provider/model" reference.

export const ModelRefSchema = z.object({
  provider: z.string(),
  model: z.string(),
});
export type ModelRef = z.infer<typeof ModelRefSchema>;

// ─── Model Catalog Entry ──────────────────────────────────────
// Represents a resolved model in the unified catalog (runtime view).

export const ModelCatalogEntrySchema = z.object({
  /** Unique key: "provider/model" */
  id: z.string(),
  /** Human-friendly name */
  name: z.string(),
  /** Provider identifier */
  provider: z.string(),
  /** Model identifier within the provider */
  model: z.string(),
  /** Where this entry came from */
  source: z.enum(['builtin', 'config', 'discovered', 'user']),
  /** API protocol */
  api: ModelApiSchema.optional(),
  /** Max context window */
  contextWindow: z.number().int().positive().optional(),
  /** Whether model supports reasoning/thinking */
  reasoning: z.boolean().default(false),
  /** Supported input modalities */
  input: z.array(ModelInputTypeSchema).default(['text']),
  /** Cost per 1M tokens */
  cost: ModelCostConfigSchema.optional(),
  /** Max output tokens */
  maxTokens: z.number().int().positive().optional(),
  /** Provider base URL */
  baseUrl: z.string().optional(),
  /** API key (runtime resolved, not raw config) */
  apiKey: z.string().optional(),
  /** Custom headers */
  headers: z.record(z.string(), z.string()).optional(),
  /** Compatibility overrides */
  compat: ModelCompatConfigSchema.optional(),
});
export type ModelCatalogEntry = z.infer<typeof ModelCatalogEntrySchema>;

// ─── Fallback Configuration ───────────────────────────────────

export const FallbackConfigSchema = z.object({
  /** Enable fallback to next model in chain on any error */
  enabled: z.boolean().default(true),
  /** Enable fallback specifically for rate limit errors */
  fallbackOnRateLimit: z.boolean().default(true),
  /** Enable fallback for non-rate-limit errors (e.g. 500) */
  fallbackOnError: z.boolean().default(false),
  /** Enable fallback for context overflow (message too long) */
  fallbackOnContextOverflow: z.boolean().default(true),
  /** Max retry attempts per model before moving to next in chain */
  maxRetries: z.number().int().min(1).max(10).default(3),
  /** Cooldown period in ms after a provider fails */
  cooldownMs: z.number().int().min(0).default(60_000),
  /** Whether to probe cooled-down providers to check recovery */
  probeOnCooldown: z.boolean().default(true),
  /** Minimum interval between probes in ms */
  probeIntervalMs: z.number().int().min(0).default(30_000),
});
export type FallbackConfig = z.infer<typeof FallbackConfigSchema>;

// ─── Utility Functions ────────────────────────────────────────

/**
 * Parse a "provider/model" string into a ModelRef.
 * Returns null if the format is invalid.
 */
export function parseModelRef(raw: string, defaultProvider?: string): ModelRef | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const slashIndex = trimmed.indexOf('/');
  if (slashIndex > 0) {
    const provider = trimmed.slice(0, slashIndex).trim();
    const model = trimmed.slice(slashIndex + 1).trim();
    if (provider && model) {
      return { provider, model };
    }
  }

  // No slash — use default provider if available
  if (defaultProvider) {
    return { provider: defaultProvider, model: trimmed };
  }

  return null;
}

/**
 * Format a ModelRef into a "provider/model" string.
 */
export function formatModelRef(ref: ModelRef): string {
  return `${ref.provider}/${ref.model}`;
}

/**
 * Check if a catalog entry supports vision (image input).
 */
export function modelSupportsVision(entry: ModelCatalogEntry | undefined): boolean {
  return entry?.input?.includes('image') ?? false;
}

/**
 * Check if a catalog entry supports reasoning/thinking.
 */
export function modelSupportsReasoning(entry: ModelCatalogEntry | undefined): boolean {
  return entry?.reasoning ?? false;
}

/**
 * Find a model in a catalog by provider and model ID (case-insensitive).
 */
export function findModelInCatalog(
  catalog: ModelCatalogEntry[],
  provider: string,
  modelId: string,
): ModelCatalogEntry | undefined {
  const np = provider.toLowerCase().trim();
  const nm = modelId.toLowerCase().trim();
  return catalog.find((e) => e.provider.toLowerCase() === np && e.model.toLowerCase() === nm);
}
