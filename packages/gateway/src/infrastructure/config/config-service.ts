/**
 * @file packages/gateway/src/infrastructure/config/config-service.ts
 * @description Implements infrastructure adapters and external integrations.
 */

import { singleton } from 'tsyringe';
import { loadConfig, saveConfig, type AdytumConfig } from '../../config.js';
import { Logger } from '../../logger.js';

/**
 * Encapsulates config service behavior.
 */
@singleton()
export class ConfigService {
  private config: AdytumConfig | null = null;

  constructor(private logger: Logger) {}

  /**
   * Executes load.
   * @returns The load result.
   */
  public load(): AdytumConfig {
    try {
      this.config = loadConfig();
      return this.config;
    } catch (err) {
      this.logger.error('Failed to load config', err);
      throw err;
    }
  }

  /**
   * Executes get.
   * @param key - Key.
   * @returns The get result.
   */
  public get<K extends keyof AdytumConfig>(key: K): AdytumConfig[K] {
    if (!this.config) {
      this.load();
    }
    return this.config![key];
  }

  /**
   * Executes set.
   * @param updates - Updates.
   */
  public set(updates: Partial<AdytumConfig>): void {
    saveConfig(updates);
    // Reload internal state
    this.config = { ...this.config, ...updates } as AdytumConfig;
    this.logger.debug('Config updated', Object.keys(updates));
  }

  /**
   * Retrieves full config.
   * @returns The get full config result.
   */
  public getFullConfig(): AdytumConfig {
    if (!this.config) {
      this.load();
    }
    return this.config!;
  }
}
