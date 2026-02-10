import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { SkillMetadata } from '@adytum/shared';

export interface LoadedSkill {
  metadata: SkillMetadata;
  instructions: string;
  path: string;
}

/**
 * Discovers and loads skills from workspace/skills/.
 * Each skill folder must contain a SKILL.md with YAML frontmatter.
 */
export class SkillLoader {
  private skills: LoadedSkill[] = [];
  private skillsDir: string;

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
      } catch {
        // Skip invalid skills
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
   * This is appended to the system prompt so the agent knows what skills are available.
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

  /**
   * Get the full instructions for a specific skill (injected when the agent needs it).
   */
  getSkillInstructions(name: string): string | undefined {
    return this.get(name)?.instructions;
  }

  /** Parse SKILL.md with YAML frontmatter. */
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
      requires: parsed.metadata?.openclaw?.requires || parsed.requires,
    };

    return { metadata, instructions: markdownPart.trim() };
  }
}
