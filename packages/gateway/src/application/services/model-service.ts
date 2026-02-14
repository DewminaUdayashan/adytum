import { singleton, inject } from 'tsyringe';
import { Logger } from '../../logger.js';
import { ConfigService } from '../../infrastructure/config/config-service.js';
import { ModelRepository, ModelEntry } from '../../domain/interfaces/model-repository.interface.js';

@singleton()
export class ModelService {
  private onChainsUpdate: ((chains: Record<string, string[]>) => void) | null = null;

  constructor(
    @inject(Logger) private logger: Logger,
    @inject(ConfigService) private configService: ConfigService,
    @inject('ModelRepository') private modelRepo: ModelRepository
  ) {}

  public setChainsUpdateCallback(cb: (chains: Record<string, string[]>) => void) {
    this.onChainsUpdate = cb;
  }

  public async getAllModels(): Promise<ModelEntry[]> {
    return this.modelRepo.getAll();
  }

  public async addModel(entry: ModelEntry): Promise<void> {
    await this.modelRepo.add(entry);
    await this.syncToConfig(entry);
  }

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

  public async removeModel(id: string): Promise<void> {
    await this.modelRepo.remove(id);
    
    // Also remove from config
    const config = this.configService.getFullConfig();
    const filtered = (config.models || []).filter((m: any) => `${m.provider}/${m.model}` !== id);
    if (filtered.length !== (config.models || []).length) {
      this.configService.set({ models: filtered });
    }
  }

  public async scanLocalModels(): Promise<ModelEntry[]> {
    return this.modelRepo.scanLocalModels();
  }
}
