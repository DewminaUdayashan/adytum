import { singleton } from 'tsyringe';
import { loadConfig, saveConfig, type AdytumConfig } from '../../config.js';
import { Logger } from '../../logger.js';

@singleton()
export class ConfigService {
  private config: AdytumConfig | null = null;

  constructor(private logger: Logger) {}

  public load(): AdytumConfig {
    try {
      this.config = loadConfig();
      return this.config;
    } catch (err) {
      this.logger.error('Failed to load config', err);
      throw err;
    }
  }

  public get<K extends keyof AdytumConfig>(key: K): AdytumConfig[K] {
    if (!this.config) {
      this.load();
    }
    return this.config![key];
  }

  public set(updates: Partial<AdytumConfig>): void {
    saveConfig(updates);
    // Reload internal state
    this.config = { ...this.config, ...updates } as AdytumConfig;
    this.logger.info('Config updated', Object.keys(updates));
  }
  
  public getFullConfig(): AdytumConfig {
    if (!this.config) {
      this.load();
    }
    return this.config!;
  }
}
