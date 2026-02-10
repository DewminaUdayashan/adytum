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
  };

  cachedConfig = AdytumConfigSchema.parse(merged);

  // Ensure directories exist
  mkdirSync(cachedConfig.workspacePath, { recursive: true });
  mkdirSync(cachedConfig.dataPath, { recursive: true });

  return cachedConfig;
}

export function saveConfig(config: Partial<AdytumConfig>, projectRoot?: string): void {
  const root = projectRoot || process.cwd();
  const configPath = join(root, 'adytum.config.yaml');
  const yaml = stringifyYaml(config);
  writeFileSync(configPath, yaml, 'utf-8');
  cachedConfig = null; // Invalidate cache
}

export function resetConfigCache(): void {
  cachedConfig = null;
}
