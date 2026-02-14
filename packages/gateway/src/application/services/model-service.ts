/**
 * @file packages/gateway/src/application/services/model-service.ts
 * @description Implements application-level service logic and coordination.
 */

import { singleton, inject } from 'tsyringe';
import { Logger } from '../../logger.js';
import { ConfigService } from '../../infrastructure/config/config-service.js';
import { ModelRepository, ModelEntry } from '../../domain/interfaces/model-repository.interface.js';

/**
 * Encapsulates model service behavior.
 */
@singleton()
export class ModelService {
  private onChainsUpdate: ((chains: Record<string, string[]>) => void) | null = null;

  constructor(
    @inject(Logger) private logger: Logger,
    @inject(ConfigService) private configService: ConfigService,
    @inject('ModelRepository') private modelRepo: ModelRepository
  ) {}

  /**
   * Sets chains update callback.
   * @param cb - Cb.
   */
  public setChainsUpdateCallback(cb: (chains: Record<string, string[]>) => void) {
    this.onChainsUpdate = cb;
  }

  /**
   * Retrieves all models.
   * @returns The resulting collection of values.
   */
  public async getAllModels(): Promise<ModelEntry[]> {
    return this.modelRepo.getAll();
  }

  /**
   * Executes add model.
   * @param entry - Entry.
   */
  public async addModel(entry: ModelEntry): Promise<void> {
    await this.modelRepo.add(entry);
    await this.syncToConfig(entry);
  }

  /**
   * Executes update model.
   * @param id - Id.
   * @param updates - Updates.
   * @returns Whether the operation succeeded.
   */
  public async updateModel(id: string, updates: Partial<ModelEntry>): Promise<boolean> {
    const success = await this.modelRepo.update(id, updates);
    if (success) {
      const entry = await this.modelRepo.get(id);
      if (entry) {
        await this.syncToConfig(entry);
      }
    }
    return success;
  }

  /**
   * Executes sync to config.
   * @param entry - Entry.
   */
  private async syncToConfig(entry: ModelEntry): Promise<void> {
    const config = this.configService.getFullConfig();
    const existingModels = [...(config.models || [])];
    const idx = existingModels.findIndex((m: any) => `${m.provider}/${m.model}` === entry.id);

    const patch = {
      role: existingModels[idx]?.role || 'fast',
      provider: entry.provider,
      model: entry.model,
      baseUrl: entry.baseUrl,
      apiKey: entry.apiKey,
    };

    if (idx >= 0) {
      existingModels[idx] = { ...existingModels[idx], ...patch };
    } else {
      existingModels.push(patch);
    }
    
    this.configService.set({ models: existingModels });
    this.logger.info({ modelId: entry.id }, 'Model synced to adytum.config.yaml');
  }

  /**
   * Executes remove model.
   * @param id - Id.
   */
  public async removeModel(id: string): Promise<void> {
    await this.modelRepo.remove(id);
    
    // Also remove from config
    const config = this.configService.getFullConfig();
    const filtered = (config.models || []).filter((m: any) => `${m.provider}/${m.model}` !== id);
    if (filtered.length !== (config.models || []).length) {
      this.configService.set({ models: filtered });
    }
  }

  /**
   * Executes scan local models.
   * @returns The resulting collection of values.
   */
  public async scanLocalModels(): Promise<ModelEntry[]> {
    return this.modelRepo.scanLocalModels();
  }
}
