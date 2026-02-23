/**
 * @file packages/gateway/src/infrastructure/llm/model-catalog.ts
 * @description Implements infrastructure adapters and external integrations.
 */

import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { type AdytumConfig } from '@adytum/shared';
import * as pi from '@mariozechner/pi-ai';
import { singleton, inject } from 'tsyringe';
import type {
  ModelRepository,
  ModelEntry,
} from '../../domain/interfaces/model-repository.interface.js';
import { Logger } from '../../logger.js';
import { resolveAllProviders } from './provider-merge.js';
import { resolveApiKeyValue } from './provider-env-resolver.js';
import { discoverLocalModels } from './provider-discovery.js';
import { AuthResolver } from './auth-resolver.js';
import { ModelSelector } from './model-selection.js';
import { FallbackManager } from './model-fallback.js';
import { ObservabilityManager } from './model-observability.js';

// Initialize pi-ai built-ins once
try {
  pi.registerBuiltInApiProviders();
} catch (e) {
  // Ignore if already registered
}

export { ModelEntry };

import { loadConfig } from '../../config.js';

/**
 * Encapsulates model catalog behavior.
 */
@singleton()
export class ModelCatalog implements ModelRepository {
  private catalogPath: string;
  private models: Map<string, ModelEntry> = new Map();
  private detailsCache: Map<string, any> = new Map();
  private aliases: Map<string, string> = new Map();
  private config: AdytumConfig;
  private providersInitialized = false;
  private authResolver: AuthResolver | null = null;
  private selector: ModelSelector | null = null;
  private fallbackManager: FallbackManager | null = null;
  private observability: ObservabilityManager = new ObservabilityManager();

  constructor(@inject(Logger) private logger: Logger) {
    this.config = loadConfig();
    this.catalogPath = join(this.config.workspacePath || process.cwd(), 'models.json');
    this.logger.debug('ModelCatalog initialized');
    this.load();
  }

  /**
   * Initialize provider infrastructure (env detection, discovery, merge).
   * This is async and should be called once during gateway startup.
   */
  async initProviders(): Promise<void> {
    if (this.providersInitialized) return;
    this.providersInitialized = true;

    const config = loadConfig();
    const { providers, implicitProviders, discoveredProviders } = await resolveAllProviders({
      explicitConfig: config.modelProviders,
    });

    // Initialize auth resolver
    this.authResolver = new AuthResolver({
      workspacePath: config.workspacePath || process.cwd(),
    });

    // Load resolved providers into catalog
    for (const [providerId, providerCfg] of Object.entries(providers)) {
      const providerBaseUrl = providerCfg.baseUrl;
      const providerApi = providerCfg.api;
      const providerHeaders = providerCfg.headers;

      // Resolve API key through auth chain
      const auth = this.authResolver.resolve(
        providerId,
        providerCfg.apiKey,
        providerCfg.auth ?? 'api-key',
      );
      const providerApiKey = auth?.secret;

      if (auth) {
        this.logger.debug(
          { provider: providerId, source: auth.sourceDetail },
          'Resolved auth credential',
        );
      }

      for (const modelDef of providerCfg.models || []) {
        const id = `${providerId}/${modelDef.id}`;
        if (this.models.has(id)) continue; // don't override existing entries

        this.models.set(id, {
          id,
          name: modelDef.name || modelDef.id,
          provider: providerId,
          model: modelDef.id,
          source: providerCfg.discovered ? 'discovered' : 'config',
          baseUrl: providerBaseUrl,
          apiKey: providerApiKey,
          api: modelDef.api || providerApi,
          reasoning: modelDef.reasoning ?? false,
          input: modelDef.input ?? ['text'],
          contextWindow: modelDef.contextWindow,
          maxTokens: modelDef.maxTokens,
          cost: modelDef.cost ?? undefined,
          inputCost: modelDef.cost?.input,
          outputCost: modelDef.cost?.output,
          compat: modelDef.compat ?? undefined,
          headers: { ...providerHeaders, ...modelDef.headers },
        });
      }
    }

    // Load aliases from config
    const aliases = config.modelProviders?.aliases ?? {};
    for (const [alias, target] of Object.entries(aliases)) {
      this.aliases.set(alias.toLowerCase().trim(), target);
    }

    this.logger.debug(
      {
        implicitProviders,
        discoveredProviders,
        totalModels: this.models.size,
        aliases: this.aliases.size,
      },
      'Provider infrastructure initialized',
    );

    // Initialize model selector with aliases and config
    this.selector = new ModelSelector({
      aliases: config.modelProviders?.aliases ?? {},
    });

    // Initialize fallback manager
    this.fallbackManager = new FallbackManager(config.fallback ?? {});

    this.logger.debug('Selection and fallback engines initialized');
  }

  /**
   * Get the model selector for alias resolution and capability filtering.
   */
  getSelector(): ModelSelector | null {
    return this.selector;
  }

  /**
   * Get the fallback manager for cooldown and fallback logic.
   */
  getFallbackManager(): FallbackManager | null {
    return this.fallbackManager;
  }

  /**
   * Get the observability manager for cost tracking, health, and analytics.
   */
  getObservability(): ObservabilityManager {
    return this.observability;
  }

  /**
   * Executes load.
   */
  private load() {
    this.models.clear();
    // Refresh config in case it changed
    this.config = loadConfig();
    const config = this.config;

    // 1. Load built-in models from pi-ai
    try {
      const providers = pi.getProviders();
      for (const providerId of providers) {
        if (typeof providerId !== 'string') continue;
        const providerModels = pi.getModels(providerId);
        for (const m of providerModels) {
          const id = `${m.provider}/${m.id}`;
          // pi-ai provides pricing in cost/1k or cost/1M?
          // Looking at pi-ai types (inferred), it might have .pricing object
          // For now, we'll try to extract if present, or leave undefined to fall back to router defaults
          const cost = m.cost;
          this.models.set(id, {
            id,
            name: m.name || m.id,
            provider: m.provider,
            model: m.id,
            contextWindow: m.contextWindow,
            reasoning: m.reasoning,
            input: m.input,
            inputCost: cost?.input,
            outputCost: cost?.output,
            source: 'default',
            baseUrl: m.baseUrl,
          });
          this.detailsCache.set(id, m);
        }
      }
    } catch (e) {
      this.logger.warn('Failed to load pi-ai models', e);
    }

    // 1.5. Load from modelProviders config (new provider-grouped format)
    if (config.modelProviders?.providers) {
      for (const [providerId, providerCfg] of Object.entries(config.modelProviders.providers)) {
        const providerApi = providerCfg.api;
        const providerBaseUrl = providerCfg.baseUrl;
        const providerApiKey = providerCfg.apiKey;
        const providerHeaders = providerCfg.headers;

        for (const modelDef of providerCfg.models || []) {
          const id = `${providerId}/${modelDef.id}`;
          const existing = this.models.get(id);

          const entry: ModelEntry = {
            id,
            name: modelDef.name || modelDef.id,
            provider: providerId,
            model: modelDef.id,
            source: providerCfg.discovered ? 'discovered' : 'config',
            baseUrl: providerBaseUrl,
            apiKey: providerApiKey,
            api: modelDef.api || providerApi,
            reasoning: modelDef.reasoning ?? false,
            input: modelDef.input ?? ['text'],
            contextWindow: modelDef.contextWindow,
            maxTokens: modelDef.maxTokens,
            cost: modelDef.cost ?? undefined,
            inputCost: modelDef.cost?.input,
            outputCost: modelDef.cost?.output,
            compat: modelDef.compat ?? undefined,
            headers: { ...providerHeaders, ...modelDef.headers },
          };

          if (existing) {
            // Provider config merges onto existing builtin entries
            Object.assign(existing, {
              ...entry,
              source: existing.source, // keep original source
            });
          } else {
            this.models.set(id, entry);
          }
        }
      }
      this.logger.debug(
        { providerCount: Object.keys(config.modelProviders.providers).length },
        'Loaded models from modelProviders config',
      );
    }

    // 2. Load from disk (User overrides/additions)
    if (existsSync(this.catalogPath)) {
      try {
        const raw = readFileSync(this.catalogPath, 'utf-8');
        const stored: ModelEntry[] = JSON.parse(raw);
        for (const m of stored) {
          this.models.set(m.id, { ...m, source: 'user' });
        }
      } catch (e) {
        this.logger.error('Failed to load models.json', e);
      }
    }

    // 3. Seed from adytum.config.yaml models[] (CLI-configured models)
    if (config.models && Array.isArray(config.models)) {
      for (const mc of config.models) {
        const id = `${mc.provider}/${mc.model}`;
        const existing = this.models.get(id);

        if (!existing) {
          this.models.set(id, {
            id,
            name: mc.model,
            provider: mc.provider,
            model: mc.model,
            source: 'default',
            baseUrl: mc.baseUrl,
            apiKey: mc.apiKey,
          });
        } else {
          // Merge config fields (baseUrl, apiKey) into existing entry
          // Important: CLI models in adytum.config.yaml should be treated as high priority
          // but if we have a 'user' model from models.json it usually means a dashboard override.
          if (mc.baseUrl) existing.baseUrl = mc.baseUrl;
          if (mc.apiKey) existing.apiKey = mc.apiKey;
        }
      }
    }
  }

  /**
   * Executes save.
   */
  save() {
    // Refresh config
    this.config = loadConfig();
    const config = this.config;
    const userModels = Array.from(this.models.values()).filter((m) => m.source === 'user');
    try {
      if (!existsSync(config.workspacePath)) {
        mkdirSync(config.workspacePath, { recursive: true });
      }
      writeFileSync(this.catalogPath, JSON.stringify(userModels, null, 2), 'utf-8');
    } catch (e) {
      this.logger.error('Failed to save models.json', e);
    }
  }

  /**
   * Retrieves all.
   * @returns The resulting collection of values.
   */
  async getAll(): Promise<ModelEntry[]> {
    return Array.from(this.models.values());
  }

  /**
   * Executes get.
   * @param id - Id.
   * @returns The get result.
   */
  async get(id: string): Promise<ModelEntry | undefined> {
    return this.models.get(id);
  }

  /**
   * Executes add.
   * @param entry - Entry.
   */
  async add(entry: ModelEntry): Promise<void> {
    this.models.set(entry.id, { ...entry, source: 'user' as const });
    this.save();
  }

  /**
   * Executes update.
   * @param id - Id.
   * @param updates - Updates.
   * @returns Whether the operation succeeded.
   */
  async update(
    id: string,
    updates: Partial<Pick<ModelEntry, 'baseUrl' | 'apiKey' | 'name'>>,
  ): Promise<boolean> {
    const entry = this.models.get(id);
    if (!entry) return false;
    if (updates.baseUrl !== undefined) entry.baseUrl = updates.baseUrl || undefined;
    if (updates.apiKey !== undefined) entry.apiKey = updates.apiKey || undefined;
    if (updates.name !== undefined) entry.name = updates.name;

    // If we are updating a default/discovered model, convert it to 'user' so it persists
    entry.source = 'user';
    this.models.set(id, entry);
    this.save();
    return true;
  }

  /**
   * Executes remove.
   * @param id - Id.
   */
  async remove(id: string): Promise<void> {
    if (this.models.has(id)) {
      // If it's a default model, we can't really "remove" it permanently from pi-ai,
      // but we can maybe hide it or just allow removing user models.
      // For now, only remove from our map. If it's default, it will reappear on restart.
      // Ideally we only allow removing 'user' source models.
      const entry = this.models.get(id);
      if (entry && entry.source !== 'user') {
        // Check if we have an override, if so remove the override
        // But here we are just deleting from map.
        // For now let's just allow it, but it won't persist deletion of defaults.
      }
      this.models.delete(id);
      this.save(); // Only saves user models
    }
  }

  /**
   * Scan for local models (Ollama, etc.)
   */
  async scanLocalModels(): Promise<ModelEntry[]> {
    const discovered: ModelEntry[] = [];
    const localModels = await discoverLocalModels();

    for (const [providerId, models] of localModels) {
      for (const modelDef of models) {
        const id = `${providerId}/${modelDef.id}`;
        const baseUrlMap: Record<string, string> = {
          ollama: 'http://localhost:11434/v1',
          lmstudio: 'http://localhost:1234/v1',
          vllm: 'http://127.0.0.1:8000/v1',
        };

        const entry: ModelEntry = {
          id,
          name: modelDef.name || modelDef.id,
          provider: providerId,
          model: modelDef.id,
          source: 'discovered',
          baseUrl: baseUrlMap[providerId] ?? '',
          reasoning: modelDef.reasoning ?? false,
          input: modelDef.input ?? ['text'],
          contextWindow: modelDef.contextWindow,
          maxTokens: modelDef.maxTokens,
          cost: modelDef.cost ?? undefined,
        };

        discovered.push(entry);
        if (!this.models.has(id)) {
          this.models.set(id, entry);
        }
      }
    }

    this.logger.debug({ count: discovered.length }, 'Local model scan complete');
    return discovered;
  }

  /**
   * Retrieves pi model.
   * @param aliasOrId - Alias or id.
   * @returns The get pi model result.
   */
  async getPiModel(aliasOrId: string): Promise<any> {
    if (this.detailsCache.has(aliasOrId)) return this.detailsCache.get(aliasOrId);
    // If alias, resolve first
    const resolved = await this.resolveModel(aliasOrId);
    if (resolved && this.detailsCache.has(resolved.id)) {
      return this.detailsCache.get(resolved.id);
    }
    return undefined;
  }

  /**
   * Resolve a model ID to a full configuration.
   * Handles aliases and provider/model syntax.
   */
  async resolveModel(aliasOrId: string): Promise<ModelEntry | undefined> {
    // 1. Check in-memory catalog first
    if (this.models.has(aliasOrId)) return this.models.get(aliasOrId);

    // 2. Check aliases
    const aliasTarget = this.aliases.get(aliasOrId.toLowerCase().trim());
    if (aliasTarget && this.models.has(aliasTarget)) {
      return this.models.get(aliasTarget);
    }

    // 3. Case-insensitive search in catalog
    const lower = aliasOrId.toLowerCase().trim();
    for (const [key, entry] of this.models) {
      if (key.toLowerCase() === lower) return entry;
    }

    // 4. Provider/model format — return a basic entry if not found
    if (aliasOrId.includes('/')) {
      const [provider, model] = aliasOrId.split('/');
      return {
        id: aliasOrId,
        name: aliasOrId,
        provider,
        model,
        source: 'default',
      };
    }

    return undefined;
  }
}
