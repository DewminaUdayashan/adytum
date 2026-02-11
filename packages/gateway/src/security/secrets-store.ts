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

  private save() {
    writeFileSync(this.filePath, JSON.stringify(this.cache, null, 2), 'utf-8');
    try {
      chmodSync(this.filePath, 0o600);
    } catch {
      // best effort
    }
  }

  listSkillKeys(skillId: string): string[] {
    return Object.keys(this.cache.skills[skillId] || {});
  }

  getSkillEnv(skillId: string): Record<string, string> {
    return { ...(this.cache.skills[skillId] || {}) };
  }

  getAll(): Record<string, Record<string, string>> {
    return JSON.parse(JSON.stringify(this.cache.skills));
  }

  setSkillSecret(skillId: string, key: string, value: string): void {
    if (!this.cache.skills[skillId]) this.cache.skills[skillId] = {};
    this.cache.skills[skillId][key] = value;
    this.save();
  }

  deleteSkillSecret(skillId: string, key: string): void {
    if (!this.cache.skills[skillId]) return;
    delete this.cache.skills[skillId][key];
    this.save();
  }
}
