import { relative, join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { singleton, inject } from 'tsyringe';
import { Logger } from '../../logger.js';
import { ConfigService } from '../../infrastructure/config/config-service.js';
import { SkillLoader, type LoadedSkill as Skill } from '../services/skill-loader.js';
import { type AdytumConfig } from '@adytum/shared';

@singleton()
export class SkillService {
  private onReloadCallback: (() => Promise<void>) | null = null;

  constructor(
    @inject(Logger) private logger: Logger,
    @inject(ConfigService) private configService: ConfigService,
    @inject(SkillLoader) private loader: SkillLoader
  ) {}

  public setReloadCallback(cb: () => Promise<void>) {
    this.onReloadCallback = cb;
  }

  public getAllSkills(): Skill[] {
    return this.loader.getAll();
  }

  public getSkill(id: string): Skill | undefined {
    return this.loader?.getAll().find((s) => s.id === id);
  }

  public getSkillInstructions(id: string) {
    const skill = this.getSkill(id);
    if (!skill) return null;

    const files = skill.instructionFiles.map((fullPath) => {
      const rel = relative(skill.path, fullPath);
      let content = '';
      try {
        content = readFileSync(fullPath, 'utf-8');
      } catch (err) {
        this.logger.error(`Failed to read instruction file: ${fullPath}`, err);
      }
      return {
        path: fullPath,
        relativePath: rel,
        content,
        editable: !skill.readonly,
      };
    });

    return {
      files,
      combined: skill.instructions,
    };
  }

  public async updateSkillInstructions(id: string, relativePath: string, content: string): Promise<void> {
    const skill = this.getSkill(id);
    if (!skill) throw new Error(`Skill ${id} not found`);
    if (skill.readonly) throw new Error(`Skill ${id} is read-only`);

    const fullPath = join(skill.path, relativePath);
    // Safety check: ensure the path is within the skill directory
    if (!fullPath.startsWith(skill.path)) {
      throw new Error('Invalid instruction path');
    }

    writeFileSync(fullPath, content, 'utf-8');
    this.logger.info(`Updated instructions for skill ${id}: ${relativePath}`);
    await this.reloadSkills();
  }

  public async updateSkill(id: string, data: { enabled?: boolean; config?: any; installPermission?: string }): Promise<void> {
    const config = this.configService.getFullConfig();
    const skills = config.skills || { enabled: true, entries: {}, allow: [], deny: [] };
    const entries = skills.entries || {};
    const entry = entries[id] || {};

    if (data.enabled !== undefined) entry.enabled = data.enabled;
    if (data.config !== undefined) entry.config = data.config;
    if (data.installPermission !== undefined) entry.installPermission = data.installPermission as any;

    entries[id] = entry;
    this.configService.set({ skills: { ...skills, entries } as any });
    this.logger.info(`Updated config for skill ${id}`);
    await this.reloadSkills();
  }

  public async setSkillSecrets(id: string, secrets: Record<string, string>): Promise<void> {
    this.loader.setSkillSecrets(id, secrets);
    this.logger.info(`Updated secrets for skill ${id}`);
    await this.reloadSkills();
  }

  public async reloadSkills(): Promise<void> {
    if (this.onReloadCallback) {
      await this.onReloadCallback();
    }
  }

  // TODO: Add methods for install, update, etc. moving logic from server.ts
}
