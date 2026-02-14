/**
 * @file packages/gateway/src/domain/interfaces/model-repository.interface.ts
 * @description Declares domain contracts used across the gateway.
 */

export interface ModelEntry {
  id: string; // "provider/model"
  name: string; // Display name
  provider: string; // e.g. "anthropic", "openai"
  model: string; // e.g. "claude-3-5-sonnet-20241022"
  contextWindow?: number;
  reasoning?: boolean;
  apiKey?: string;
  baseUrl?: string;
  source: 'default' | 'user' | 'discovered';
  input?: ('text' | 'image')[];
}

export interface ModelRepository {
  getAll(): Promise<ModelEntry[]>;
  get(id: string): Promise<ModelEntry | undefined>;
  add(entry: ModelEntry): Promise<void>;
  update(id: string, updates: Partial<Pick<ModelEntry, 'baseUrl' | 'apiKey' | 'name'>>): Promise<boolean>;
  remove(id: string): Promise<void>;
  scanLocalModels(): Promise<ModelEntry[]>;
  resolveModel(aliasOrId: string): Promise<ModelEntry | undefined>;
}
