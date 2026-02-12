
import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { type AdytumConfig } from '@adytum/shared';
import * as pi from '@mariozechner/pi-ai';

// Initialize pi-ai built-ins once
try {
  pi.registerBuiltInApiProviders();
} catch (e) {
  // Ignore if already registered
}

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

export class ModelCatalog {
  private config: AdytumConfig;
  private catalogPath: string;
  private models: Map<string, ModelEntry> = new Map();
  private detailsCache: Map<string, any> = new Map();

  constructor(config: AdytumConfig) {
    this.config = config;
    this.catalogPath = join(this.config.workspacePath || process.cwd(), 'models.json');
    this.load();
  }

  private load() {
    this.models.clear();

    // 1. Load built-in models from pi-ai
    // @ts-ignore - pi-ai types might be missing getProviders if it's new
    const providers = pi.getProviders();
    for (const providerId of providers) {
        if (typeof providerId !== 'string') continue;
        const providerModels = pi.getModels(providerId);
        for (const m of providerModels) {
            const id = `${m.provider}/${m.id}`;
            this.models.set(id, {
                id,
                name: m.name || m.id,
                provider: m.provider,
                model: m.id,
                contextWindow: m.contextWindow,
                reasoning: m.reasoning,
                input: m.input,
                source: 'default',
                baseUrl: m.baseUrl,
            });
            this.detailsCache.set(id, m);
        }
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
        console.error('Failed to load models.json', e);
      }
    }
  }

  save() {
    const userModels = Array.from(this.models.values()).filter((m) => m.source === 'user');
    try {
      if (!existsSync(this.config.workspacePath)) {
        mkdirSync(this.config.workspacePath, { recursive: true });
      }
      writeFileSync(this.catalogPath, JSON.stringify(userModels, null, 2), 'utf-8');
    } catch (e) {
      console.error('Failed to save models.json', e);
    }
  }

  getAll(): ModelEntry[] {
    return Array.from(this.models.values());
  }

  get(id: string): ModelEntry | undefined {
    return this.models.get(id);
  }

  add(entry: ModelEntry) {
    this.models.set(entry.id, { ...entry, source: 'user' });
    this.save();
  }

  remove(id: string) {
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

    // Check Ollama
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1000);
      
      const res = await fetch('http://localhost:11434/api/tags', { signal: controller.signal });
      clearTimeout(timeout);

      if (res.ok) {
        const data = (await res.json()) as any;
        for (const model of data.models || []) {
          const name = model.name;
          // Ollama models usually don't have provider prefix in name, so we add it
          const id = `ollama/${name}`;
          const entry: ModelEntry = {
            id,
            name,
            provider: 'ollama',
            model: name,
            source: 'discovered',
            baseUrl: 'http://localhost:11434/v1',
          };
          discovered.push(entry);
          
          if (!this.models.has(id)) {
             this.models.set(id, entry);
          }
        }
      }
    } catch (e) {
      // Ollama not running
    }

    // Check LM Studio
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 1000);
        const res = await fetch('http://localhost:1234/v1/models', { signal: controller.signal });
        clearTimeout(timeout);

        if (res.ok) {
            const data = (await res.json()) as any;
            for (const model of data.data || []) {
                const name = model.id;
                const id = `lmstudio/${name}`;
                const entry: ModelEntry = {
                    id,
                    name,
                    provider: 'lmstudio',
                    model: name,
                    source: 'discovered',
                    baseUrl: 'http://localhost:1234/v1',
                };
                discovered.push(entry);
                 if (!this.models.has(id)) {
                     this.models.set(id, entry);
                 }
            }
        }
    } catch(e) { /* LM Studio not running */ }

    return discovered;
  }

  getPiModel(aliasOrId: string): any {
      if (this.detailsCache.has(aliasOrId)) return this.detailsCache.get(aliasOrId);
      // If alias, resolve first
      const resolved = this.resolveModel(aliasOrId);
      if (resolved && this.detailsCache.has(resolved.id)) {
          return this.detailsCache.get(resolved.id);
      }
      return undefined;
  }

  /**
   * Resolve a model ID to a full configuration.
   * Handles aliases and provider/model syntax.
   */
  resolveModel(aliasOrId: string): ModelEntry | undefined {
    // 1. Check in-memory catalog
    if (this.models.has(aliasOrId)) return this.models.get(aliasOrId);

    // 2. Check basic provider/model format (e.g. "anthropic/claude-3-opus")
    // If not in catalog, we try to see if it's a known provider in pi-ai
    if (aliasOrId.includes('/')) {
      const [provider, model] = aliasOrId.split('/');
      
      // Try to find if pi-ai knows this provider
      // pi-ai providers: anthropic, openai, etc.
      
      // If we didn't find it in getModels(), maybe it's a new model or custom
      // Return a basic entry
       return {
          id: aliasOrId,
          name: aliasOrId,
          provider,
          model,
          source: 'default',
          // We don't have baseUrl unless we know the provider config
          // But pi-ai's getApiProvider might have it
       };
    }

    return undefined;
  }
}
