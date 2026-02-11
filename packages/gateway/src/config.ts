import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { config as loadDotenv } from 'dotenv';
import { AdytumConfigSchema, type AdytumConfig } from '@adytum/shared';

const DEFAULT_DATA_DIR = join(
  process.env.HOME || process.env.USERPROFILE || '.',
  '.adytum',
  'data',
);

let cachedConfig: AdytumConfig | null = null;

const parseBool = (value?: string): boolean | undefined => {
  if (value === undefined) return undefined;
  const normalized = value.toLowerCase().trim();
  if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
  return undefined;
};

const parseList = (value?: string | string[]): string[] | undefined => {
  if (!value) return undefined;
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  return value.split(',').map((v) => v.trim()).filter(Boolean);
};

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
  const fileDiscord = (fileConfig.discord as Record<string, unknown> | undefined) || {};
  const envDiscordEnabled = parseBool(process.env.ADYTUM_DISCORD_ENABLED);
  const envAllowDm = parseBool(process.env.ADYTUM_DISCORD_ALLOW_DMS);
  const envAllowedChannels = parseList(process.env.ADYTUM_DISCORD_ALLOWED_CHANNEL_IDS);
  const envAllowedUsers = parseList(process.env.ADYTUM_DISCORD_ALLOWED_USER_IDS);

  const merged = {
    agentName: fileConfig.agentName || process.env.ADYTUM_AGENT_NAME || 'Adytum',
    userName: fileConfig.userName || process.env.ADYTUM_USER_NAME,
    userRole: fileConfig.userRole || process.env.ADYTUM_USER_ROLE,
    userPreferences: fileConfig.userPreferences || process.env.ADYTUM_USER_PREFS,
    workspacePath: resolve(
      (fileConfig.workspacePath as string) || process.env.ADYTUM_WORKSPACE || join(root, 'workspace'),
    ),
    dataPath: resolve(
      (fileConfig.dataPath as string) || process.env.ADYTUM_DATA_DIR || DEFAULT_DATA_DIR,
    ),
    models: fileConfig.models || [],
    litellmPort: Number(fileConfig.litellmPort || process.env.LITELLM_PORT || 4000),
    gatewayPort: Number(fileConfig.gatewayPort || process.env.GATEWAY_PORT || 3001),
    dashboardPort: Number(fileConfig.dashboardPort || process.env.DASHBOARD_PORT || 3000),
    contextSoftLimit: Number(fileConfig.contextSoftLimit || 40000),
    heartbeatIntervalMinutes: Number(fileConfig.heartbeatIntervalMinutes || 30),
    dreamerIntervalMinutes: Number(fileConfig.dreamerIntervalMinutes || 30),
    monologueIntervalMinutes: Number(fileConfig.monologueIntervalMinutes || 15),
    discord: {
      enabled: (fileDiscord.enabled as boolean | undefined)
        ?? envDiscordEnabled
        ?? Boolean(fileDiscord.botToken || process.env.ADYTUM_DISCORD_BOT_TOKEN),
      botToken: (fileDiscord.botToken as string | undefined) || process.env.ADYTUM_DISCORD_BOT_TOKEN,
      defaultChannelId: (fileDiscord.defaultChannelId as string | undefined) || process.env.ADYTUM_DISCORD_DEFAULT_CHANNEL_ID,
      guildId: (fileDiscord.guildId as string | undefined) || process.env.ADYTUM_DISCORD_GUILD_ID,
      allowedChannelIds: parseList(fileDiscord.allowedChannelIds as string[] | string | undefined) || envAllowedChannels,
      allowedUserIds: parseList(fileDiscord.allowedUserIds as string[] | string | undefined) || envAllowedUsers,
      allowDm: (fileDiscord.allowDm as boolean | undefined) ?? envAllowDm,
    },
  };

  cachedConfig = AdytumConfigSchema.parse(merged);

  // Ensure directories exist
  mkdirSync(cachedConfig.workspacePath, { recursive: true });
  mkdirSync(cachedConfig.dataPath, { recursive: true });

  return cachedConfig;
}

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

export function resetConfigCache(): void {
  cachedConfig = null;
}
