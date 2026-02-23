/**
 * @file packages/gateway/src/config.ts
 * @description Defines module behavior for the Adytum workspace.
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { config as loadDotenv } from 'dotenv';
import { AdytumConfigSchema, type AdytumConfig } from '@adytum/shared';
export type { AdytumConfig };

const DEFAULT_DATA_DIR = join(
  process.env.HOME || process.env.USERPROFILE || '.',
  '.adytum',
  'data',
);

let cachedConfig: AdytumConfig | null = null;

/**
 * Parses bool.
 * @param value - Value.
 * @returns The parse bool result.
 */
const parseBool = (value?: string): boolean | undefined => {
  if (value === undefined) return undefined;
  const normalized = value.toLowerCase().trim();
  if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
  return undefined;
};

/**
 * Parses list.
 * @param value - Value.
 * @returns The parse list result.
 */
const parseList = (value?: string | string[]): string[] | undefined => {
  if (!value) return undefined;
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
};

/**
 * Determines whether is record.
 * @param value - Value.
 * @returns The is record result.
 */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Parses skill entries.
 * @param value - Value.
 * @returns The parse skill entries result.
 */
const parseSkillEntries = (
  value: unknown,
):
  | Record<
      string,
      {
        enabled?: boolean;
        config?: Record<string, unknown>;
        env?: Record<string, string>;
        apiKey?: string;
        installPermission?: 'auto' | 'ask' | 'deny';
      }
    >
  | undefined => {
  if (!isRecord(value)) return undefined;

  const entries: Record<
    string,
    {
      enabled?: boolean;
      config?: Record<string, unknown>;
      env?: Record<string, string>;
      apiKey?: string;
      installPermission?: 'auto' | 'ask' | 'deny';
    }
  > = {};
  for (const [id, rawEntry] of Object.entries(value)) {
    if (!id.trim()) continue;

    if (!isRecord(rawEntry)) {
      entries[id] = {};
      continue;
    }

    const enabled = typeof rawEntry.enabled === 'boolean' ? rawEntry.enabled : undefined;
    const config = isRecord(rawEntry.config) ? { ...rawEntry.config } : undefined;
    const env =
      isRecord(rawEntry.env) && Object.values(rawEntry.env).every((v) => typeof v === 'string')
        ? (rawEntry.env as Record<string, string>)
        : undefined;
    const apiKey = typeof rawEntry.apiKey === 'string' ? rawEntry.apiKey : undefined;
    const installPermission =
      typeof rawEntry.installPermission === 'string' &&
      ['auto', 'ask', 'deny'].includes(rawEntry.installPermission)
        ? (rawEntry.installPermission as 'auto' | 'ask' | 'deny')
        : undefined;
    entries[id] = { enabled, config, env, apiKey, installPermission };
  }

  return entries;
};

/**
 * Loads config.
 * @param projectRoot - Project root.
 * @returns The load config result.
 */
export function loadConfig(projectRoot?: string): AdytumConfig {
  if (cachedConfig) return cachedConfig;

  const root = projectRoot || process.cwd();

  // Load .env file
  const envPath = join(root, '.env');
  if (existsSync(envPath)) {
    loadDotenv({ path: envPath });
  }

  // Load adytum.config.yaml
  const configPath = join(root, 'adytum.config.yaml');
  let fileConfig: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    const raw = readFileSync(configPath, 'utf-8');
    fileConfig = parseYaml(raw) || {};
  }

  // Merge env + file config
  const fileSkills = isRecord(fileConfig.skills) ? fileConfig.skills : {};
  const fileSkillsLoad = isRecord(fileSkills.load) ? fileSkills.load : {};
  const fileSkillsPermissions = isRecord(fileSkills.permissions) ? fileSkills.permissions : {};
  const envSkillsEnabled = parseBool(process.env.ADYTUM_SKILLS_ENABLED);
  const envSkillsAllow = parseList(process.env.ADYTUM_SKILLS_ALLOW);
  const envSkillsDeny = parseList(process.env.ADYTUM_SKILLS_DENY);
  const envSkillsLoadPaths = parseList(process.env.ADYTUM_SKILLS_LOAD_PATHS);
  const fileExecution = isRecord(fileConfig.execution) ? fileConfig.execution : {};

  const merged = {
    agentName: fileConfig.agentName || process.env.ADYTUM_AGENT_NAME || 'Adytum',
    userName: fileConfig.userName || process.env.ADYTUM_USER_NAME,
    userRole: fileConfig.userRole || process.env.ADYTUM_USER_ROLE,
    userPreferences: fileConfig.userPreferences || process.env.ADYTUM_USER_PREFS,
    workspacePath: resolve(
      root,
      (fileConfig.workspacePath as string) || process.env.ADYTUM_WORKSPACE || 'workspace',
    ),
    dataPath: resolve(
      root,
      (fileConfig.dataPath as string) || process.env.ADYTUM_DATA_DIR || DEFAULT_DATA_DIR,
    ),
    models: fileConfig.models || [],
    modelChains: fileConfig.modelChains || {
      thinking: [],
      fast: [],
      local: [],
    },
    taskOverrides: fileConfig.taskOverrides || {},
    soul: {
      autoUpdate: (fileConfig.soul as any)?.autoUpdate ?? true,
    },
    gatewayPort: Number(fileConfig.gatewayPort || process.env.GATEWAY_PORT || 3001),
    dashboardPort: Number(fileConfig.dashboardPort || process.env.DASHBOARD_PORT || 3002),
    contextSoftLimit: Number(fileConfig.contextSoftLimit || 40000),
    heartbeatIntervalMinutes: Number(fileConfig.heartbeatIntervalMinutes || 30),
    dreamerIntervalMinutes: Number(fileConfig.dreamerIntervalMinutes || 30),
    monologueIntervalMinutes: Number(fileConfig.monologueIntervalMinutes || 15),
    execution: {
      shell: (fileExecution.shell as 'auto' | 'ask' | 'deny') || ('ask' as 'auto' | 'ask' | 'deny'),
      defaultChannel:
        typeof fileExecution.defaultChannel === 'string' ? fileExecution.defaultChannel : undefined,
      defaultUser:
        typeof (fileExecution as any).defaultUser === 'string'
          ? (fileExecution as any).defaultUser
          : undefined,
      defaultCommSkillId:
        typeof fileExecution.defaultCommSkillId === 'string'
          ? fileExecution.defaultCommSkillId
          : undefined,
      approvalBaseUrl:
        typeof fileExecution.approvalBaseUrl === 'string'
          ? fileExecution.approvalBaseUrl
          : process.env.ADYTUM_PUBLIC_URL,
    },
    routing: {
      maxRetries: Number((fileConfig as any)?.routing?.maxRetries ?? 5),
      fallbackOnRateLimit: (fileConfig as any)?.routing?.fallbackOnRateLimit ?? true,
      fallbackOnError: (fileConfig as any)?.routing?.fallbackOnError ?? false,
    },
    skills: {
      enabled: (fileSkills.enabled as boolean | undefined) ?? envSkillsEnabled ?? true,
      allow: parseList(fileSkills.allow as string[] | string | undefined) || envSkillsAllow || [],
      deny: parseList(fileSkills.deny as string[] | string | undefined) || envSkillsDeny || [],
      load: {
        paths:
          parseList(fileSkillsLoad.paths as string[] | string | undefined) ||
          envSkillsLoadPaths ||
          [],
        extraDirs: parseList(fileSkillsLoad.extraDirs as string[] | string | undefined) || [],
      },
      permissions: {
        install:
          (fileSkillsPermissions.install as 'auto' | 'ask' | 'deny') ||
          ('ask' as 'auto' | 'ask' | 'deny'),
        defaultChannel:
          typeof fileSkillsPermissions.defaultChannel === 'string'
            ? fileSkillsPermissions.defaultChannel
            : undefined,
        defaultUser:
          typeof (fileSkillsPermissions as any).defaultUser === 'string'
            ? (fileSkillsPermissions as any).defaultUser
            : undefined,
      },
      entries: parseSkillEntries(fileSkills.entries) || {},
    },
  };

  cachedConfig = AdytumConfigSchema.parse(merged);

  // Ensure directories exist
  mkdirSync(cachedConfig.workspacePath, { recursive: true });
  mkdirSync(cachedConfig.dataPath, { recursive: true });

  return cachedConfig;
}

/**
 * Persists config.
 * @param updates - Updates.
 * @param projectRoot - Project root.
 */
export function saveConfig(updates: Partial<AdytumConfig>, projectRoot?: string): void {
  const root = projectRoot || process.cwd();
  const configPath = join(root, 'adytum.config.yaml');

  // Read existing config file to merge with (don't overwrite entire file)
  let existing: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    try {
      existing = parseYaml(readFileSync(configPath, 'utf-8')) || {};
    } catch {
      // If parsing fails, start fresh
    }
  }

  // Merge updates into existing config
  const merged = { ...existing, ...updates };
  const yaml = stringifyYaml(merged);
  writeFileSync(configPath, yaml, 'utf-8');
  cachedConfig = null; // Invalidate cache
}

/**
 * Resets config cache.
 */
export function resetConfigCache(): void {
  cachedConfig = null;
}
