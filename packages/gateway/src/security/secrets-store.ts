/**
 * @file packages/gateway/src/security/secrets-store.ts
 * @description Provides security utilities and policy enforcement logic.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'node:fs';
import { join } from 'node:path';

type SecretsFile = {
  skills: Record<string, Record<string, string>>;
};

/**
 * Minimal secrets store persisted under data/secrets.json.
 * Values are plaintext on disk; dashboard must mask in UI and logs.
 * File perms set to 600 when created.
 */
export class SecretsStore {
  private filePath: string;
  private cache: SecretsFile = { skills: {} };

  constructor(dataPath: string) {
    mkdirSync(dataPath, { recursive: true });
    this.filePath = join(dataPath, 'secrets.json');
    this.load();
  }

  /**
   * Executes load.
   */
  private load() {
    if (!existsSync(this.filePath)) return;
    try {
      const raw = readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as SecretsFile;
      if (parsed && typeof parsed === 'object' && parsed.skills) {
        this.cache = parsed;
      }
    } catch {
      // ignore malformed file; keep empty cache
    }
  }

  /**
   * Executes save.
   */
  private save() {
    writeFileSync(this.filePath, JSON.stringify(this.cache, null, 2), 'utf-8');
    try {
      chmodSync(this.filePath, 0o600);
    } catch {
      // best effort
    }
  }

  /**
   * Executes list skill keys.
   * @param skillId - Skill id.
   * @returns The resulting collection of values.
   */
  listSkillKeys(skillId: string): string[] {
    return Object.keys(this.cache.skills[skillId] || {});
  }

  /**
   * Retrieves skill env.
   * @param skillId - Skill id.
   * @returns The get skill env result.
   */
  getSkillEnv(skillId: string): Record<string, string> {
    return { ...(this.cache.skills[skillId] || {}) };
  }

  /**
   * Retrieves all.
   * @returns The get all result.
   */
  getAll(): Record<string, Record<string, string>> {
    return JSON.parse(JSON.stringify(this.cache.skills));
  }

  /**
   * Sets skill secret.
   * @param skillId - Skill id.
   * @param key - Key.
   * @param value - Value.
   */
  setSkillSecret(skillId: string, key: string, value: string): void {
    if (!this.cache.skills[skillId]) this.cache.skills[skillId] = {};
    this.cache.skills[skillId][key] = value;
    this.save();
  }

  /**
   * Executes delete skill secret.
   * @param skillId - Skill id.
   * @param key - Key.
   */
  deleteSkillSecret(skillId: string, key: string): void {
    if (!this.cache.skills[skillId]) return;
    delete this.cache.skills[skillId][key];
    this.save();
  }
}
