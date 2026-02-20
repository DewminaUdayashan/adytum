/**
 * @file packages/gateway/src/domain/interfaces/model-repository.interface.ts
 * @description Declares domain contracts used across the gateway.
 */

import type { ModelApi, ModelCompatConfig, ModelCostConfig } from '@adytum/shared';

export interface ModelEntry {
  id: string; // "provider/model"
  name: string; // Display name
  provider: string; // e.g. "anthropic", "openai"
  model: string; // e.g. "claude-3-5-sonnet-20241022"
  contextWindow?: number;
  reasoning?: boolean;
  apiKey?: string;
  baseUrl?: string;
  source: 'default' | 'user' | 'discovered' | 'builtin' | 'config';
  input?: ('text' | 'image' | 'audio' | 'video')[];
  /** @deprecated Use cost.input instead */
  inputCost?: number; // Cost per 1M tokens
  /** @deprecated Use cost.output instead */
  outputCost?: number; // Cost per 1M tokens
  /** Structured cost data (per 1M tokens) */
  cost?: ModelCostConfig;
  /** API protocol type */
  api?: ModelApi;
  /** Maximum output tokens per request */
  maxTokens?: number;
  /** Per-model compatibility quirks */
  compat?: ModelCompatConfig;
  /** Custom headers for this model */
  headers?: Record<string, string>;
}

export interface ModelRepository {
  getAll(): Promise<ModelEntry[]>;
  get(id: string): Promise<ModelEntry | undefined>;
  add(entry: ModelEntry): Promise<void>;
  update(
    id: string,
    updates: Partial<Pick<ModelEntry, 'baseUrl' | 'apiKey' | 'name'>>,
  ): Promise<boolean>;
  remove(id: string): Promise<void>;
  scanLocalModels(): Promise<ModelEntry[]>;
  resolveModel(aliasOrId: string): Promise<ModelEntry | undefined>;
}
