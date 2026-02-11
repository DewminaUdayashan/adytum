import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { createJiti } from 'jiti';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import type { SkillMetadata, AdytumSkill } from '@adytum/shared';
import type { ToolRegistry } from '../tools/registry.js';

const __filename = fileURLToPath(import.meta.url);

export interface LoadedSkill {
  metadata: SkillMetadata;
  instructions: string;
  path: string;
  module?: AdytumSkill;
}

/**
 * Discovers and loads skills from workspace/skills/.
 * Each skill folder must contain a SKILL.md with YAML frontmatter.
 * Can optionally contain executable code (index.ts/js) defining tools.
 */
export class SkillLoader {
  private skills: LoadedSkill[] = [];
  private skillsDir: string;
  private jiti = createJiti(__filename);

  constructor(workspacePath: string) {
    this.skillsDir = join(workspacePath, 'skills');
    this.discover();
  }

  /** Scan the skills directory for SKILL.md files. */
  discover(): void {
    this.skills = [];

    if (!existsSync(this.skillsDir)) return;

    const entries = readdirSync(this.skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillMdPath = join(this.skillsDir, entry.name, 'SKILL.md');
      if (!existsSync(skillMdPath)) continue;

      try {
        const raw = readFileSync(skillMdPath, 'utf-8');
        const { metadata, instructions } = this.parseSkillMd(raw);

        this.skills.push({
          metadata,
          instructions,
          path: join(this.skillsDir, entry.name),
        });
      } catch (err: any) {
        console.warn(`Skipping invalid skill at ${entry.name}: ${err.message}`);
      }
    }
  }

  /**
   * Initialize executable parts of skills (Adytum Standard).
   * Loads index.ts/js and registers tools.
   */
  async init(toolRegistry: ToolRegistry): Promise<void> {
    const executableSkills = this.skills.filter(s => this.findEntryFile(s.path, s.metadata));
    if (executableSkills.length > 0) {
      console.log(chalk.dim(`  Initializing ${executableSkills.length} Adytum skills...`));
    }

    for (const skill of this.skills) {
      const entryFile = this.findEntryFile(skill.path, skill.metadata);
      
      if (entryFile) {
        try {
          // Dynamic import via jiti to support TS/ESM/CJS
          const mod = await this.jiti.import(entryFile) as AdytumSkill | { default: AdytumSkill };
          const expandedMod = 'default' in mod ? mod.default : mod;
          
          skill.module = expandedMod;

          if (expandedMod.tools) {
            for (const tool of expandedMod.tools) {
              toolRegistry.register(tool);
            }
          }
          
          if (expandedMod.onLoad) {
            await expandedMod.onLoad();
          }
          
          // console.log(chalk.green('    ✓ ') + `Loaded ${skill.metadata.name}`);
        } catch (err: any) {
          console.error(chalk.red(`    ❌ Failed to load skill code for ${skill.metadata.name}:`), err.message);
        }
      }
    }
  }

  /** Get all loaded skills. */
  getAll(): LoadedSkill[] {
    return [...this.skills];
  }

  /** Get a skill by name. */
  get(name: string): LoadedSkill | undefined {
    return this.skills.find((s) => s.metadata.name === name);
  }

  /**
   * Build a context injection string with all skill descriptions.
   */
  getSkillsContext(): string {
    if (this.skills.length === 0) return '';

    const lines = ['## Available Skills\n'];
    for (const skill of this.skills) {
      lines.push(`### ${skill.metadata.name}`);
      lines.push(skill.metadata.description);
      lines.push('');
    }
    return lines.join('\n');
  }

  getSkillInstructions(name: string): string | undefined {
    return this.get(name)?.instructions;
  }

  private parseSkillMd(raw: string): { metadata: SkillMetadata; instructions: string } {
    const frontmatterRegex = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
    const match = raw.match(frontmatterRegex);

    if (!match) {
      throw new Error('Invalid SKILL.md: missing YAML frontmatter');
    }

    const yamlPart = match[1];
    const markdownPart = match[2];

    const parsed = parseYaml(yamlPart);
    const metadata: SkillMetadata = {
      name: parsed.name || 'unknown',
      description: parsed.description || '',
      version: parsed.version,
      // Support legacy and Adytum locations
      requires: parsed.metadata?.adytum?.requires || parsed.requires || parsed.adytum?.requires,
      adytum: parsed.adytum || parsed.metadata?.adytum, 
    };

    return { metadata, instructions: markdownPart.trim() };
  }

  private findEntryFile(skillPath: string, metadata: SkillMetadata): string | undefined {
    // 1. Explicit entry
    const explicit = (metadata.adytum as any)?.entry;
    if (explicit) {
       return resolve(skillPath, explicit);
    }

    // 2. Standard conventions
    const candidates = ['index.ts', 'index.js', 'skill.ts', 'skill.js'];
    for (const c of candidates) {
      const p = join(skillPath, c);
      if (existsSync(p)) return p;
    }
    return undefined;
  }
}
