import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { createJiti } from 'jiti';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import { parse as parseYaml } from 'yaml';
import type { AdytumConfig, ToolDefinition } from '@adytum/shared';
import type { ToolRegistry } from '../tools/registry.js';
import type { AgentRuntime } from './runtime.js';

const __filename = fileURLToPath(import.meta.url);
const MANIFEST_FILE = 'adytum.plugin.json';
const SKILL_MD = 'SKILL.md';
const ENTRY_CANDIDATES = [
  'index.ts',
  'index.js',
  'index.mts',
  'index.mjs',
  'index.cts',
  'index.cjs',
];

export type SkillOrigin = 'workspace' | 'managed' | 'extra';

export interface SkillManifest {
  id: string;
  name?: string;
  description?: string;
  version?: string;
  kind?: string;
  channels?: string[];
  providers?: string[];
  skills?: string[];
  uiHints?: Record<string, unknown>;
  configSchema: Record<string, unknown>;
  metadata?: ReturnType<typeof resolveMetadata>;
}

export interface LoadedSkill {
  id: string;
  name: string;
  description?: string;
  version?: string;
  path: string;
  source?: string;
  manifestPath?: string;
  origin: SkillOrigin;
  enabled: boolean;
  status: 'discovered' | 'loaded' | 'disabled' | 'error';
  error?: string;
  toolNames: string[];
  serviceIds: string[];
  instructions: string;
  instructionFiles: string[];
  manifest?: SkillManifest;
  module?: AdytumSkillPluginDefinition;
  eligible?: boolean;
  missing?: {
    bins: string[];
    anyBins: string[];
    env: string[];
    config: string[];
    os: string[];
  };
  communication?: boolean;
  install?: Array<Record<string, unknown>>;
}

type SkillMissing = {
  bins: string[];
  anyBins: string[];
  env: string[];
  config: string[];
  os: string[];
};

export interface SkillLogger {
  debug: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

export interface SkillServiceContext {
  agent: AgentRuntime;
  toolRegistry: ToolRegistry;
  workspacePath: string;
  dataPath: string;
  projectRoot: string;
  config: AdytumConfig;
  pluginConfig?: Record<string, unknown>;
  logger: SkillLogger;
}

export interface AdytumSkillService {
  id: string;
  start: (ctx: SkillServiceContext) => Promise<void> | void;
  stop?: (ctx: SkillServiceContext) => Promise<void> | void;
}

export interface AdytumSkillPluginApi {
  id: string;
  name: string;
  source: string;
  rootDir: string;
  manifest: SkillManifest;
  config: AdytumConfig;
  pluginConfig?: Record<string, unknown>;
  logger: SkillLogger;
  resolvePath: (value: string) => string;
  registerTool: (tool: ToolDefinition) => void;
  registerService: (service: AdytumSkillService) => void;
}

export interface AdytumSkillPluginDefinition {
  id?: string;
  name?: string;
  description?: string;
  version?: string;
  register?: (api: AdytumSkillPluginApi) => Promise<void> | void;
  activate?: (api: AdytumSkillPluginApi) => Promise<void> | void;
}

type LegacySkillModule = {
  tools?: ToolDefinition[];
  onLoad?: () => Promise<void> | void;
  onUnload?: () => Promise<void> | void;
};

type SkillModuleExport =
  | AdytumSkillPluginDefinition
  | LegacySkillModule
  | ((api: AdytumSkillPluginApi) => Promise<void> | void);

type ParsedFrontmatter = {
  data: Record<string, unknown>;
  body: string;
};

const parseFrontmatter = (raw: string): ParsedFrontmatter => {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    return { data: {}, body: raw };
  }
  try {
    const data = parseYaml(match[1]) as Record<string, unknown>;
    return { data, body: match[2] || '' };
  } catch {
    return { data: {}, body: raw };
  }
};

const resolveStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((v) => String(v).trim()).filter(Boolean) : [];

const resolveMetadata = (data: Record<string, unknown>) => {
  const rawMeta = isRecord(data.metadata) ? (data.metadata as Record<string, unknown>) : {};
  const manifestBlock = isRecord(rawMeta.manifest) ? (rawMeta.manifest as Record<string, unknown>) : undefined;
  const oc = isRecord(rawMeta.openclaw)
    ? (rawMeta.openclaw as Record<string, unknown>)
    : manifestBlock || rawMeta;
  const requires = (data.requires as Record<string, unknown>) || (oc.requires as Record<string, unknown>) || {};
  const primaryEnv = typeof (data.primaryEnv || oc.primaryEnv) === 'string' ? String(data.primaryEnv || oc.primaryEnv).trim() : undefined;
  const always = typeof (data.always ?? oc.always) === 'boolean' ? (data.always ?? oc.always) : undefined;
  const installRaw = Array.isArray(oc.install) ? oc.install : Array.isArray(rawMeta.install) ? rawMeta.install : [];
  const install = installRaw.filter((entry) => isRecord(entry)).map((entry) => entry as Record<string, unknown>);
  const skillKey = typeof (oc.skillKey ?? rawMeta.skillKey) === 'string'
    ? String(oc.skillKey ?? rawMeta.skillKey).trim()
    : undefined;
  const homepage = typeof (oc.homepage ?? rawMeta.homepage) === 'string'
    ? String(oc.homepage ?? rawMeta.homepage).trim()
    : undefined;
  const emoji = typeof (oc.emoji ?? rawMeta.emoji) === 'string'
    ? String(oc.emoji ?? rawMeta.emoji).trim()
    : undefined;
  const communication =
    typeof (data.communication ?? oc.communication) === 'boolean'
      ? (data.communication ?? oc.communication)
      : undefined;
  return {
    name: typeof data.name === 'string' ? data.name.trim() : undefined,
    description: typeof data.description === 'string' ? data.description.trim() : undefined,
    version: typeof data.version === 'string' ? data.version.trim() : undefined,
    skillKey,
    homepage,
    emoji,
    requires: {
      bins: resolveStringArray(requires.bins),
      anyBins: resolveStringArray(requires.anyBins),
      env: resolveStringArray(requires.env),
      config: resolveStringArray(requires.config),
      os: resolveStringArray(requires.os),
    },
    primaryEnv,
    always,
    communication,
    install,
  };
};

const resolveConfigPathTruthy = (cfg: AdytumConfig, pathStr: string): boolean => {
  const parts = pathStr.split('.').filter(Boolean);
  let cursor: any = cfg;
  for (const part of parts) {
    if (cursor && typeof cursor === 'object' && part in cursor) {
      cursor = cursor[part];
    } else {
      return false;
    }
  }
  if (cursor === undefined || cursor === null) return false;
  if (typeof cursor === 'boolean') return cursor;
  if (typeof cursor === 'number') return cursor !== 0;
  if (typeof cursor === 'string') return cursor.trim().length > 0;
  return true;
};

interface SkillCandidate {
  rootDir: string;
  source?: string;
  origin: SkillOrigin;
  priority: number;
  hasSkillMd: boolean;
}

interface ServiceRegistration {
  pluginId: string;
  pluginName: string;
  service: AdytumSkillService;
  pluginConfig?: Record<string, unknown>;
  logger: SkillLogger;
  started: boolean;
}

interface SkillLoaderOptions {
  projectRoot?: string;
  dataPath?: string;
  config?: AdytumConfig;
}

  /**
   * Adytum skill loader.
   *
   * Supports:
   *   1) Plugin-style skills: adytum.plugin.json + entry file (index.* or package.json adytum.extensions)
   *   2) Instruction-only skills: SKILL.md (AgentSkills / OpenClaw style)
   */
export class SkillLoader {
  private skills: LoadedSkill[] = [];
  private skillsDir: string;
  private toolRegistry: ToolRegistry | null = null;
  private services: ServiceRegistration[] = [];
  private activeAgent: AgentRuntime | null = null;
  private secrets: Record<string, Record<string, string>> = {};
  private jiti = createJiti(__filename, {
    interopDefault: true,
    extensions: ['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '.json'],
  });

  private projectRoot: string;
  private dataPath: string;
  private config: AdytumConfig;
  private managedSkillsDir: string;

  constructor(workspacePath: string, options: SkillLoaderOptions = {}) {
    this.skillsDir = join(workspacePath, 'skills');
    this.projectRoot = resolve(options.projectRoot || join(workspacePath, '..'));
    this.dataPath = resolve(options.dataPath || join(this.projectRoot, 'data'));
    const home = process.env.HOME || process.env.USERPROFILE || '';
    this.managedSkillsDir = home ? resolve(home, '.adytum', 'skills') : '';
    this.config =
      options.config ||
      ({
        agentName: 'Adytum',
        workspacePath,
        dataPath: this.dataPath,
        models: [],
        litellmPort: 4000,
        gatewayPort: 3001,
        dashboardPort: 3000,
        contextSoftLimit: 40000,
        heartbeatIntervalMinutes: 30,
        dreamerIntervalMinutes: 30,
        monologueIntervalMinutes: 15,
      } as AdytumConfig);

    this.discover();
  }

  /** Rescan skills from disk and config. */
  discover(): void {
    const candidates = this.discoverCandidates();
    const discovered: Map<string, LoadedSkill & { priority: number }> = new Map();

    for (const candidate of candidates) {
      const manifestResult = this.loadManifest(candidate.rootDir, candidate.hasSkillMd);
      if (!manifestResult.ok) {
        const fallbackId = basename(candidate.rootDir);
        if (discovered.has(fallbackId)) continue;
        discovered.set(fallbackId, {
          id: fallbackId,
          name: fallbackId,
          path: candidate.rootDir,
          source: candidate.source,
          origin: candidate.origin,
          enabled: false,
          status: 'error',
          error: manifestResult.error,
          toolNames: [],
          serviceIds: [],
          instructions: '',
          instructionFiles: [],
          manifest: undefined,
          priority: candidate.priority,
        });
        continue;
      }

      const manifest = manifestResult.manifest;
      const instructionBundle = this.collectSkillInstructions(candidate.rootDir, manifest);

      const existing = discovered.get(manifest.id);
      if (existing && existing.priority > candidate.priority) {
        continue;
      }
      const state = this.resolveEnableState(manifest.id, manifest.metadata);
      discovered.set(manifest.id, {
        id: manifest.id,
        name: manifest.name || manifest.id,
        description: manifest.description,
        version: manifest.version,
        path: candidate.rootDir,
        source: candidate.source,
        manifestPath: manifestResult.manifestPath,
        origin: candidate.origin,
        enabled: state.enabled,
        status: state.enabled ? 'discovered' : 'disabled',
        error: state.enabled ? undefined : state.reason,
        toolNames: [],
        serviceIds: [],
        instructions: instructionBundle.instructions,
        instructionFiles: instructionBundle.files,
        manifest,
        eligible: state.enabled,
        missing: state.missing,
        communication: manifest.metadata?.communication === true,
        install: manifest.metadata?.install,
        priority: candidate.priority,
      });
    }

    this.skills = Array.from(discovered.values()).map(({ priority: _p, ...rest }) => rest);
  }

  /** Load and register enabled skills (tools + services). */
  async init(toolRegistry: ToolRegistry): Promise<void> {
    const staleToolNames = Array.from(new Set(this.skills.flatMap((skill) => skill.toolNames)));
    if (staleToolNames.length > 0) {
      toolRegistry.unregisterMany(staleToolNames);
    }

    this.toolRegistry = toolRegistry;
    this.services = [];
    this.discover();

    const enabled = this.skills.filter((s) => s.enabled && s.status === 'discovered');
    if (enabled.length > 0) {
      console.log(chalk.dim(`  Initializing ${enabled.length} skills...`));
    }

    for (const skill of enabled) {
      this.applyEnvOverrides(skill);
      if (!skill.source) {
        // Instruction-only skill
        skill.status = 'loaded';
        continue;
      }

      try {
        const raw = (await this.jiti.import(skill.source)) as SkillModuleExport | { default: SkillModuleExport };
        const normalized = this.resolveSkillModule(raw);

        if (!normalized) {
          throw new Error('Skill must export a plugin definition, register function, or legacy Adytum skill object');
        }

        if (normalized.type === 'legacy') {
          await this.loadLegacySkill(skill, normalized.module, toolRegistry);
        } else {
          await this.loadPluginSkill(skill, normalized.definition, toolRegistry);
        }

        skill.status = 'loaded';
      } catch (err: any) {
        skill.status = 'error';
        skill.error = err?.message || String(err);
        console.error(chalk.red(`    ✗ Failed to load skill ${skill.id}: ${skill.error}`));
      }
    }
  }

  /** Start all registered skill services after AgentRuntime is available. */
  async start(agent: AgentRuntime): Promise<void> {
    if (!this.toolRegistry) return;
    this.activeAgent = agent;

    for (const registration of this.services) {
      if (registration.started) continue;

      const ctx: SkillServiceContext = {
        agent,
        toolRegistry: this.toolRegistry,
        workspacePath: this.config.workspacePath,
        dataPath: this.config.dataPath,
        projectRoot: this.projectRoot,
        config: this.config,
        pluginConfig: registration.pluginConfig,
        logger: registration.logger,
      };

      try {
        await registration.service.start(ctx);
        registration.started = true;
        registration.logger.info(`service started (${registration.service.id})`);
      } catch (err: any) {
        registration.logger.error(`service start failed (${registration.service.id}): ${err?.message || err}`);
      }
    }
  }

  /** Stop all running services. */
  async stop(): Promise<void> {
    if (!this.toolRegistry) return;

    for (let i = this.services.length - 1; i >= 0; i -= 1) {
      const registration = this.services[i];
      if (!registration.started || !registration.service.stop) continue;

      const ctx: SkillServiceContext = {
        agent: this.activeAgent || ({} as AgentRuntime),
        toolRegistry: this.toolRegistry,
        workspacePath: this.config.workspacePath,
        dataPath: this.config.dataPath,
        projectRoot: this.projectRoot,
        config: this.config,
        pluginConfig: registration.pluginConfig,
        logger: registration.logger,
      };

      try {
        await registration.service.stop(ctx);
        registration.started = false;
      } catch (err: any) {
        registration.logger.warn(`service stop failed (${registration.service.id}): ${err?.message || err}`);
      }
    }

    this.activeAgent = null;
  }

  updateConfig(config: AdytumConfig, projectRoot?: string): void {
    this.config = config;
    if (projectRoot) {
      this.projectRoot = resolve(projectRoot);
    }
    this.dataPath = resolve(config.dataPath);
    this.skillsDir = join(config.workspacePath, 'skills');
  }

  async reload(agent: AgentRuntime): Promise<void> {
    if (!this.toolRegistry) {
      throw new Error('Skill loader has not been initialized yet');
    }

    await this.stop();
    await this.init(this.toolRegistry);
    await this.start(agent);
  }

  setSecrets(secrets: Record<string, Record<string, string>>): void {
    this.secrets = secrets;
  }

  /** Update secrets for a single skill (hot swap before reload). */
  setSkillSecrets(skillId: string, env: Record<string, string>): void {
    this.secrets = { ...this.secrets, [skillId]: { ...(env || {}) } };
  }

  /** Get all discovered skills (loaded + disabled + errored). */
  getAll(): LoadedSkill[] {
    return [...this.skills];
  }

  /** Lookup by id or display name. */
  get(name: string): LoadedSkill | undefined {
    const needle = name.trim().toLowerCase();
    return this.skills.find(
      (s) => s.id.toLowerCase() === needle || s.name.toLowerCase() === needle,
    );
  }

  /** Build system prompt context for enabled skills. */
  getSkillsContext(): string {
    const active = this.skills.filter((s) => s.enabled && s.status !== 'error');
    if (active.length === 0) return '';

    const lines: string[] = ['## Available Skills', ''];

    for (const skill of active) {
      lines.push(`### ${skill.name}`);
      if (skill.description) {
        lines.push(skill.description);
      }
      if (skill.instructions.trim()) {
        lines.push(skill.instructions.trim());
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  getSkillInstructions(name: string): string | undefined {
    return this.get(name)?.instructions;
  }

  private discoverCandidates(): SkillCandidate[] {
    const buckets: Array<{ roots: string[]; origin: SkillOrigin; priority: number }> = [
      { roots: [this.skillsDir], origin: 'workspace', priority: 3 },
      { roots: this.managedSkillsDir ? [this.managedSkillsDir] : [], origin: 'managed', priority: 2 },
      {
        roots:
          this.config.skills?.load?.paths?.map((p) =>
            isAbsolute(p) ? resolve(p) : resolve(this.projectRoot, p),
          ) || [],
        origin: 'extra',
        priority: 1,
      },
      {
        roots:
          this.config.skills?.load?.extraDirs?.map((p) =>
            isAbsolute(p) ? resolve(p) : resolve(this.projectRoot, p),
          ) || [],
        origin: 'extra',
        priority: 1,
      },
    ];

    const candidates: SkillCandidate[] = [];
    const seen = new Set<string>();

    const addCandidate = (candidate: SkillCandidate) => {
      const key = resolve(candidate.rootDir);
      if (seen.has(key)) return;
      seen.add(key);
      candidates.push({
        rootDir: resolve(candidate.rootDir),
        source: candidate.source ? resolve(candidate.source) : undefined,
        origin: candidate.origin,
        priority: candidate.priority,
        hasSkillMd: candidate.hasSkillMd,
      });
    };

    for (const bucket of buckets) {
      for (const root of bucket.roots) {
        if (!root || !existsSync(root)) continue;
        const statRoot = statSync(root);
        if (statRoot.isFile()) {
          const hasSkillMd = false;
          addCandidate({
            rootDir: dirname(root),
            source: root,
            origin: bucket.origin,
            priority: bucket.priority,
            hasSkillMd,
          });
          continue;
        }

        const directSkillMd = join(root, SKILL_MD);
        const directSource = this.resolveEntrySource(root);
        const hasSkillMd = existsSync(directSkillMd);
        if (directSource || hasSkillMd) {
          addCandidate({
            rootDir: root,
            source: directSource,
            origin: bucket.origin,
            priority: bucket.priority,
            hasSkillMd,
          });
        }

        const entries = readdirSync(root, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const childRoot = join(root, entry.name);
          const childSource = this.resolveEntrySource(childRoot);
          const childHasSkillMd = existsSync(join(childRoot, SKILL_MD));
          if (!childSource && !childHasSkillMd) continue;
          addCandidate({
            rootDir: childRoot,
            source: childSource,
            origin: bucket.origin,
            priority: bucket.priority,
            hasSkillMd: childHasSkillMd,
          });
        }
      }
    }

    // De-duplicate by skill id later (when manifest/frontmatter parsed) using priority.
    return candidates;
  }

  private resolveEntrySource(rootDir: string): string | undefined {
    const packageJsonPath = join(rootDir, 'package.json');

    if (existsSync(packageJsonPath)) {
      try {
        const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as Record<string, unknown>;
        const adytum = pkg.adytum as Record<string, unknown> | undefined;
        const extensions = Array.isArray(adytum?.extensions)
          ? adytum?.extensions
          : undefined;

        if (extensions && extensions.length > 0) {
          for (const extPath of extensions) {
            if (typeof extPath !== 'string' || !extPath.trim()) continue;
            const source = resolve(rootDir, extPath);
            if (existsSync(source)) return source;
          }
        }
      } catch {
        // Ignore invalid package.json here; manifest validation will surface later.
      }
    }

    for (const candidate of ENTRY_CANDIDATES) {
      const source = join(rootDir, candidate);
      if (existsSync(source)) return source;
    }

    return undefined;
  }

  private loadManifest(rootDir: string, allowInstructionOnly = false):
    | { ok: true; manifest: SkillManifest; manifestPath: string }
    | { ok: false; error: string; manifestPath: string } {
    const manifestPath = join(rootDir, MANIFEST_FILE);
    const skillMdPath = join(rootDir, SKILL_MD);
    const hasManifest = existsSync(manifestPath);
    const hasSkillMd = existsSync(skillMdPath);

    if (!hasManifest && allowInstructionOnly && hasSkillMd) {
      // Build minimal manifest from SKILL.md frontmatter
      const raw = readFileSync(skillMdPath, 'utf-8');
      const parsed = parseFrontmatter(raw);
      const meta = resolveMetadata(parsed.data);
      const id = meta.skillKey || meta.name || basename(rootDir);
      const manifest: SkillManifest = {
        id,
        name: meta.name || id,
        description: meta.description,
        version: meta.version,
        configSchema: { type: 'object', additionalProperties: false, properties: {} },
        skills: [],
        metadata: meta,
      };
      return { ok: true, manifest, manifestPath: skillMdPath };
    }

    if (!hasManifest) {
      return {
        ok: false,
        manifestPath,
        error: `Missing ${MANIFEST_FILE} in ${rootDir}`,
      };
    }

    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    } catch (err) {
      return {
        ok: false,
        manifestPath,
        error: `Failed to parse manifest: ${String(err)}`,
      };
    }

    if (!isRecord(raw)) {
      return {
        ok: false,
        manifestPath,
        error: 'Manifest must be a JSON object',
      };
    }

    const id = typeof raw.id === 'string' ? raw.id.trim() : '';
    const configSchema = isRecord(raw.configSchema) ? raw.configSchema : null;

    if (!id) {
      return {
        ok: false,
        manifestPath,
        error: 'Manifest requires non-empty "id"',
      };
    }

    if (!configSchema) {
      return {
        ok: false,
        manifestPath,
        error: 'Manifest requires "configSchema" object',
      };
    }

    const meta = resolveMetadata((raw.metadata as Record<string, unknown>) || {});
    const manifest: SkillManifest = {
      id,
      configSchema,
      name: typeof raw.name === 'string' ? raw.name.trim() : undefined,
      description: typeof raw.description === 'string' ? raw.description.trim() : undefined,
      version: typeof raw.version === 'string' ? raw.version.trim() : undefined,
      kind: typeof raw.kind === 'string' ? raw.kind.trim() : undefined,
      channels: normalizeStringList(raw.channels),
      providers: normalizeStringList(raw.providers),
      skills: normalizeStringList(raw.skills),
      uiHints: isRecord(raw.uiHints) ? raw.uiHints : undefined,
      metadata: meta,
    };

    return { ok: true, manifest, manifestPath };
  }

  private collectSkillInstructions(
    rootDir: string,
    manifest: SkillManifest,
  ): { instructions: string; files: string[] } {
    const filesToRead = new Set<string>();

    const rootSkill = join(rootDir, 'SKILL.md');
    if (existsSync(rootSkill)) {
      filesToRead.add(rootSkill);
    }

    for (const relative of manifest.skills || []) {
      const resolved = resolve(rootDir, relative);
      if (!existsSync(resolved)) continue;

      if (statSync(resolved).isDirectory()) {
        const nestedSkill = join(resolved, 'SKILL.md');
        if (existsSync(nestedSkill)) filesToRead.add(nestedSkill);
      } else {
        filesToRead.add(resolved);
      }
    }

    const sections: string[] = [];

    for (const filePath of filesToRead) {
      try {
        const raw = readFileSync(filePath, 'utf-8');
        const stripped = stripFrontmatter(raw).trim();
        if (stripped) sections.push(stripped);
      } catch {
        // Ignore malformed instruction files.
      }
    }

    return {
      instructions: sections.join('\n\n').trim(),
      files: Array.from(filesToRead.values()),
    };
  }

  private resolveEnableState(
    id: string,
    metadata?: ReturnType<typeof resolveMetadata>,
  ): { enabled: boolean; reason?: string; missing: SkillMissing } {
    const skillsConfig = this.config.skills;
    const missing: SkillMissing = { bins: [], anyBins: [], env: [], config: [], os: [] };
    if (skillsConfig?.enabled === false) {
      return { enabled: false, reason: 'Skills disabled by config', missing };
    }

    if (skillsConfig?.deny?.includes(id)) {
      return { enabled: false, reason: 'Blocked by skills.deny', missing };
    }

    if (skillsConfig?.allow && skillsConfig.allow.length > 0 && !skillsConfig.allow.includes(id)) {
      return { enabled: false, reason: 'Not listed in skills.allow', missing };
    }

    const entry = skillsConfig?.entries?.[id];
    if (entry?.enabled === false) {
      return { enabled: false, reason: 'Disabled in skills.entries', missing };
    }

    if (!metadata) {
      return { enabled: true, missing };
    }

    if (metadata.always) {
      return { enabled: true, missing };
    }

    const requiredOs = metadata.requires.os || [];
    if (requiredOs.length > 0 && !requiredOs.includes(process.platform)) {
      missing.os = requiredOs;
      return { enabled: false, reason: `OS not allowed (${process.platform})`, missing };
    }

    const requiredBins = metadata.requires.bins || [];
    for (const bin of requiredBins) {
      if (!hasBinary(bin)) {
        missing.bins.push(bin);
      }
    }

    const anyBins = metadata.requires.anyBins || [];
    if (anyBins.length > 0 && !anyBins.some((bin) => hasBinary(bin))) {
      missing.anyBins = anyBins;
    }

    const requiredEnv = metadata.requires.env || [];
    for (const envName of requiredEnv) {
      if (process.env[envName]) continue;
      const configured = entry?.env?.[envName] || entry?.apiKey;
      if (!configured || (metadata.primaryEnv && envName !== metadata.primaryEnv && !entry?.env?.[envName])) {
        missing.env.push(envName);
      }
    }

    const requiredConfig = metadata.requires.config || [];
    for (const path of requiredConfig) {
      if (!resolveConfigPathTruthy(this.config, path)) {
        missing.config.push(path);
      }
    }

    const enabled =
      missing.bins.length === 0 &&
      missing.anyBins.length === 0 &&
      missing.env.length === 0 &&
      missing.config.length === 0 &&
      missing.os.length === 0;
    return {
      enabled,
      reason: enabled ? undefined : 'Missing requirements',
      missing,
    };
  }

  private resolvePluginConfig(id: string): Record<string, unknown> | undefined {
    const value = this.config.skills?.entries?.[id]?.config;
    if (!isRecord(value)) return undefined;
    return { ...value };
  }

  private applyEnvOverrides(skill: LoadedSkill) {
    const entry = this.config.skills?.entries?.[skill.id];
    const secrets = this.secrets[skill.id] || {};

    const setIfAbsent = (key: string, val?: string) => {
      if (!key || !val) return;
      if (!process.env[key]) {
        process.env[key] = val;
      }
    };

    if (entry?.env) {
      for (const [key, val] of Object.entries(entry.env)) {
        setIfAbsent(key, val as string);
      }
    }

    for (const [key, val] of Object.entries(secrets)) {
      setIfAbsent(key, val);
    }

    const primaryEnv = skill.manifest?.metadata?.primaryEnv;
    if (primaryEnv) {
      setIfAbsent(primaryEnv, secrets[primaryEnv] || entry?.apiKey);
    }

    // If secrets include keys that look like bot token / default channel for Discord, set those too.
    if (skill.id === 'discord') {
      const token = secrets['ADYTUM_DISCORD_BOT_TOKEN'];
      const chan = secrets['ADYTUM_DISCORD_DEFAULT_CHANNEL_ID'];
      if (token && !process.env.ADYTUM_DISCORD_BOT_TOKEN) process.env.ADYTUM_DISCORD_BOT_TOKEN = token;
      if (chan && !process.env.ADYTUM_DISCORD_DEFAULT_CHANNEL_ID) process.env.ADYTUM_DISCORD_DEFAULT_CHANNEL_ID = chan;
    }
  }

  private resolveSkillModule(rawModule: unknown):
    | { type: 'plugin'; definition: AdytumSkillPluginDefinition }
    | { type: 'legacy'; module: LegacySkillModule }
    | null {
    const resolved = isRecord(rawModule) && 'default' in rawModule
      ? (rawModule as { default: unknown }).default
      : rawModule;

    if (typeof resolved === 'function') {
      return {
        type: 'plugin',
        definition: { register: resolved as AdytumSkillPluginDefinition['register'] },
      };
    }

    if (!isRecord(resolved)) {
      return null;
    }

    const hasPluginShape =
      typeof resolved.register === 'function' ||
      typeof resolved.activate === 'function';

    if (hasPluginShape) {
      return { type: 'plugin', definition: resolved as AdytumSkillPluginDefinition };
    }

    const hasLegacyShape =
      Array.isArray(resolved.tools) ||
      typeof resolved.onLoad === 'function' ||
      typeof resolved.onUnload === 'function';

    if (hasLegacyShape) {
      return { type: 'legacy', module: resolved as LegacySkillModule };
    }

    return null;
  }

  private async loadLegacySkill(
    skill: LoadedSkill,
    legacy: LegacySkillModule,
    toolRegistry: ToolRegistry,
  ): Promise<void> {
    if (legacy.tools) {
      for (const tool of legacy.tools) {
        toolRegistry.register(tool);
        skill.toolNames.push(tool.name);
      }
    }

    if (legacy.onLoad) {
      await legacy.onLoad();
    }

    if (legacy.onUnload) {
      this.services.push({
        pluginId: skill.id,
        pluginName: skill.name,
        service: {
          id: `${skill.id}:legacy-lifecycle`,
          start: () => undefined,
          stop: () => legacy.onUnload?.(),
        },
        pluginConfig: this.resolvePluginConfig(skill.id),
        logger: this.createSkillLogger(skill.id),
        started: true,
      });
    }
  }

  private async loadPluginSkill(
    skill: LoadedSkill,
    definition: AdytumSkillPluginDefinition,
    toolRegistry: ToolRegistry,
  ): Promise<void> {
    const pluginId = definition.id?.trim() || skill.id;
    const pluginName = definition.name?.trim() || skill.name;
    const logger = this.createSkillLogger(pluginId);
    const pluginConfig = this.resolvePluginConfig(pluginId) || this.resolvePluginConfig(skill.id);

    if (definition.id && definition.id !== skill.id) {
      logger.warn(`plugin id "${definition.id}" does not match manifest id "${skill.id}"; manifest id is used for config lookup`);
    }

    const configValidation = validateJsonSchemaValue(
      pluginConfig || {},
      skill.manifest?.configSchema,
      `skills.entries.${skill.id}.config`,
    );
    if (!configValidation.ok) {
      throw new Error(`Invalid plugin config: ${configValidation.errors.join('; ')}`);
    }

    const register = definition.register || definition.activate;
    if (!register) {
      throw new Error('Plugin definition must export register(api) or activate(api)');
    }

    const api: AdytumSkillPluginApi = {
      id: pluginId,
      name: pluginName,
      source: skill.source!,
      rootDir: skill.path,
      manifest: {
        ...(skill.manifest || {
          id: skill.id,
          name: skill.name,
          description: skill.description,
          version: skill.version,
          configSchema: {},
        }),
      },
      config: this.config,
      pluginConfig,
      logger,
      resolvePath: (value: string) => (isAbsolute(value) ? resolve(value) : resolve(skill.path, value)),
      registerTool: (tool: ToolDefinition) => {
        toolRegistry.register(tool);
        skill.toolNames.push(tool.name);
      },
      registerService: (service: AdytumSkillService) => {
        this.services.push({
          pluginId,
          pluginName,
          service,
          pluginConfig,
          logger,
          started: false,
        });
        skill.serviceIds.push(service.id);
      },
    };

    await register(api);

    skill.module = definition;
    skill.name = pluginName;
    skill.description = definition.description || skill.description;
    skill.version = definition.version || skill.version;
  }

  private createSkillLogger(skillId: string): SkillLogger {
    const prefix = chalk.dim(`[skill:${skillId}]`);
    return {
      debug: (message: string) => {
        if (process.env.DEBUG) console.log(prefix, chalk.gray(message));
      },
      info: (message: string) => {
        console.log(prefix, message);
      },
      warn: (message: string) => {
        console.warn(prefix, chalk.yellow(message));
      },
      error: (message: string) => {
        console.error(prefix, chalk.red(message));
      },
    };
  }
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter(Boolean);
}

function hasBinary(bin: string): boolean {
  const pathEnv = process.env.PATH || '';
  const parts = pathEnv.split(process.platform === 'win32' ? ';' : ':').filter(Boolean);
  for (const part of parts) {
    const candidate = join(part, bin);
    if (existsSync(candidate)) {
      try {
        const stat = statSync(candidate);
        if (stat.isFile()) return true;
      } catch {
        continue;
      }
    }
  }
  return false;
}

function stripFrontmatter(raw: string): string {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return raw;

  // Parse to validate YAML and then return content body.
  try {
    parseYaml(match[1]);
    return match[2] || '';
  } catch {
    return raw;
  }
}

type ValidationResult =
  | { ok: true }
  | { ok: false; errors: string[] };

function validateJsonSchemaValue(
  value: unknown,
  schema: unknown,
  path: string,
): ValidationResult {
  if (!isRecord(schema)) return { ok: true };

  const errors: string[] = [];

  const validate = (currentValue: unknown, currentSchema: unknown, currentPath: string) => {
    if (!isRecord(currentSchema)) return;

    if (Array.isArray(currentSchema.enum) && currentSchema.enum.length > 0) {
      const isValidEnum = currentSchema.enum.some((candidate) => candidate === currentValue);
      if (!isValidEnum) {
        errors.push(`${currentPath} must be one of: ${currentSchema.enum.join(', ')}`);
        return;
      }
    }

    const expectedType = typeof currentSchema.type === 'string' ? currentSchema.type : undefined;

    if (expectedType === 'object') {
      if (!isRecord(currentValue)) {
        errors.push(`${currentPath} must be an object`);
        return;
      }

      const properties = isRecord(currentSchema.properties)
        ? currentSchema.properties
        : {};
      const required = Array.isArray(currentSchema.required)
        ? currentSchema.required.filter((entry): entry is string => typeof entry === 'string')
        : [];
      const additionalProperties = currentSchema.additionalProperties;

      for (const key of required) {
        if (!(key in currentValue)) {
          errors.push(`${currentPath}.${key} is required`);
        }
      }

      if (additionalProperties === false) {
        for (const key of Object.keys(currentValue)) {
          if (!(key in properties)) {
            errors.push(`${currentPath}.${key} is not allowed`);
          }
        }
      }

      for (const [key, propertySchema] of Object.entries(properties)) {
        if (!(key in currentValue)) continue;
        validate((currentValue as Record<string, unknown>)[key], propertySchema, `${currentPath}.${key}`);
      }

      return;
    }

    if (expectedType === 'array') {
      if (!Array.isArray(currentValue)) {
        errors.push(`${currentPath} must be an array`);
        return;
      }

      if ('items' in currentSchema) {
        currentValue.forEach((item, index) => {
          validate(item, currentSchema.items, `${currentPath}[${index}]`);
        });
      }
      return;
    }

    if (expectedType === 'string' && typeof currentValue !== 'string') {
      errors.push(`${currentPath} must be a string`);
      return;
    }

    if (expectedType === 'boolean' && typeof currentValue !== 'boolean') {
      errors.push(`${currentPath} must be a boolean`);
      return;
    }

    if (expectedType === 'number' && typeof currentValue !== 'number') {
      errors.push(`${currentPath} must be a number`);
      return;
    }

    if (
      expectedType === 'integer' &&
      (typeof currentValue !== 'number' || !Number.isInteger(currentValue))
    ) {
      errors.push(`${currentPath} must be an integer`);
    }
  };

  validate(value, schema, path);

  if (errors.length === 0) return { ok: true };
  return { ok: false, errors };
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
