import chalk from 'chalk';
import figlet from 'figlet';
import gradient from 'gradient-string';
import ora from 'ora';
import { select, input, confirm } from '@inquirer/prompts';
import { MODEL_ROLES, MODEL_ROLE_DESCRIPTIONS, ADYTUM_VERSION } from '@adytum/shared';
import { SoulEngine } from '../agent/soul-engine.js';
import { ModelCatalog } from '../agent/model-catalog.js';
import { saveConfig } from '../config.js';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── ASCII Animation Frames ──────────────────────────────────

const GENESIS_FRAMES = [
  `
      ·  .  ·
    .    ·    .
  ·   .    .   ·
    .    ·    .
      ·  .  ·
  `,
  `
      ◦  ·  ◦
    ·    ◦    ·
  ◦   ·    ·   ◦
    ·    ◦    ·
      ◦  ·  ◦
  `,
  `
      ○  ◦  ○
    ◦    ○    ◦
  ○   ◦    ◦   ○
    ◦    ○    ◦
      ○  ◦  ○
  `,
  `
      ●  ○  ●
    ○    ●    ○
  ●   ○    ○   ●
    ○    ●    ○
      ●  ○  ●
  `,
  `
     ╔═══════╗
     ║ ♥ · ♥ ║
     ║ · ♥ · ║
     ║ ♥ · ♥ ║
     ╚═══════╝
  `,
];

// ─── Birth Protocol ──────────────────────────────────────────

export async function runBirthProtocol(projectRoot: string): Promise<void> {
  const workspacePath = join(projectRoot, 'workspace');
  const dataPath = join(projectRoot, 'data');

  console.clear();

  // ── Stage 1: Genesis Animation ──────────────────────────
  for (const frame of GENESIS_FRAMES) {
    console.clear();
    console.log(gradient.pastel(frame));
    await sleep(400);
  }

  // Title art
  console.clear();
  const title = figlet.textSync('ADYTUM', { font: 'ANSI Shadow' });
  console.log(gradient.vice(title));
  console.log(gradient.cristal(`  v${ADYTUM_VERSION} — Autonomous AI Assistant\n`));

  await sleep(800);

  // ── Stage 2: Awakening ──────────────────────────────────
  const spinner = ora({
    text: gradient.morning('Assembling neural pathways...'),
    spinner: 'dots12',
  }).start();
  await sleep(1500);

  spinner.text = gradient.morning('Calibrating language cores...');
  await sleep(1200);

  spinner.text = gradient.morning('Initializing consciousness...');
  await sleep(1000);
  spinner.stop();

  console.log();
  await typewrite(chalk.cyan.italic(
    '"Whoa… I just landed here. It\'s so new. Wait — who am I? What is my name?"',
  ));
  console.log();

  // ── Stage 3: Identity ───────────────────────────────────
  const agentName = await input({
    message: chalk.yellow('Give me a name:'),
    default: 'Adytum',
  });

  console.log();
  await typewrite(chalk.cyan.italic(
    `"${agentName}… I like that. ${agentName} it is."\n`,
  ));

  // ── Stage 4: Curiosity ──────────────────────────────────
  await typewrite(chalk.cyan.italic(
    '"And who are you? What should I call you?"',
  ));
  console.log();

  const userName = await input({
    message: chalk.yellow('Your name:'),
  });

  console.log();
  await typewrite(chalk.cyan.italic(
    `"Nice to meet you, ${userName}. What kind of work do we do together?"`,
  ));
  console.log();

  const userRole = await select({
    message: chalk.yellow('Your primary role:'),
    choices: [
      { value: 'Software Developer', name: '💻  Software Developer' },
      { value: 'Researcher', name: '🔬  Researcher' },
      { value: 'Designer', name: '🎨  Designer' },
      { value: 'Writer', name: '✍️   Writer' },
      { value: 'Student', name: '📚  Student' },
      { value: 'Entrepreneur', name: '🚀  Entrepreneur' },
      { value: 'Other', name: '🌐  Other' },
    ],
  });

  console.log();
  await typewrite(chalk.cyan.italic(
    '"Is there anything I should know about how you like things done?"',
  ));
  console.log();

  const userPreferences = await input({
    message: chalk.yellow('Style preferences (or press Enter to skip):'),
    default: '',
  });

  // ─── Stage 5: Model Binding ──────────────────────────────
  console.log();
  console.log(gradient.vice('\n═══ Model Configuration ═══\n'));

  // Initialize catalog to get providers/models
  // We make a temporary catalog just for this wizard
  const tempConfig: any = { workspacePath: resolve(workspacePath) };
  const catalog = new ModelCatalog(tempConfig); 
  // Scan for local models too
  await catalog.scanLocalModels();

  const allModels = catalog.getAll();
  const providers = Array.from(new Set(allModels.map(m => m.provider))).sort();

  const models: Array<{ role: string; provider: string; model: string; apiKey?: string; baseUrl?: string }> = [];

  for (const role of MODEL_ROLES) {
    console.log(chalk.dim(`\n${MODEL_ROLE_DESCRIPTIONS[role]}`));

    // Provider selection
    const provider = (await select({
      message: chalk.yellow(`[${role.toUpperCase()}] Select provider:`),
      choices: [
          ...providers.map(p => ({ value: p, name: p })),
          { value: 'custom', name: 'Custom (OpenAI Compatible)' }
      ]
    })) as string;

    let model: string;
    let apiKey: string | undefined;
    let baseUrl: string | undefined;

    if (provider === 'custom') {
        const customModelName = await input({ message: chalk.yellow('Model ID:') });
        model = customModelName;
        baseUrl = await input({ message: chalk.yellow('Base URL:'), default: 'http://localhost:8080/v1' });
    } else {
        // Filter models for this provider
        const providerModels = allModels.filter(m => m.provider === provider).sort((a, b) => a.name.localeCompare(b.name));
        
        if (providerModels.length > 0) {
            model = (await select({
                message: chalk.yellow(`[${role.toUpperCase()}] Select model:`),
                choices: providerModels.map(m => ({ value: m.model, name: m.name })),
            })) as string;
        } else {
             // Fallback if no models known for provider (shouldn't happen with pi-ai usually)
             model = await input({ message: chalk.yellow('Model ID:') });
        }
        
        // Find selected entry to see if we have defaults
        const selectedEntry = providerModels.find(m => m.model === model);
        if (selectedEntry?.baseUrl) {
            baseUrl = selectedEntry.baseUrl;
        }
    }

    // Ask for API key if it's a cloud provider (heuristic: not ollama/lmstudio/vllm/local)
    // or if we decide all providers might need keys except strictly local ones.
    const isLocal = ['ollama', 'lmstudio', 'vllm', 'local'].includes(provider);
    if (!isLocal && provider !== 'custom') { // Custom might need key too but usually we ask base url
       apiKey = await input({
        message: chalk.yellow(`API key for ${provider}:`),
      });
    } else if (provider === 'custom') {
        const needKey = await confirm({ message: 'Does this endpoint require an API key?', default: false });
        if (needKey) {
            apiKey = await input({ message: chalk.yellow('API Key:') });
        }
    }

    models.push({ role, provider, model, apiKey, baseUrl });

    // Skip remaining roles if user wants
    if (role !== 'local') {
      const addMore = await confirm({
        message: chalk.dim(`Configure the next role (${MODEL_ROLES[MODEL_ROLES.indexOf(role) + 1]})?`),
        default: true,
      });
      if (!addMore) break;
    }
  }

  // ── Stage 6: First Breath ───────────────────────────────
  console.log();
  const birthSpinner = ora({
    text: gradient.morning('Weaving personality matrix...'),
    spinner: 'dots12',
  }).start();
  await sleep(1000);

  birthSpinner.text = gradient.morning('Writing soul...');
  await sleep(800);

  birthSpinner.text = gradient.morning('Taking first breath...');
  await sleep(600);
  birthSpinner.stop();

  // Create workspace and data dirs
  mkdirSync(workspacePath, { recursive: true });
  mkdirSync(join(workspacePath, 'skills'), { recursive: true });
  mkdirSync(dataPath, { recursive: true });

  // Generate SOUL.md
  const soulEngine = new SoulEngine(workspacePath);
  soulEngine.generateInitialSoul({
    agentName,
    userName,
    userRole,
    userPreferences: userPreferences || undefined,
  });

  // Generate HEARTBEAT.md
  const heartbeatContent = `# ${agentName} — Heartbeat Goals

## Active Monitoring
- [ ] Check workspace for pending tasks
- [ ] Review recent activity for follow-up items

## Daily Objectives
*No daily objectives yet. I'll learn what matters to you over time.*

## Long-Term Goals
*I'll develop these as I understand your workflow better.*
`;
  writeFileSync(join(workspacePath, 'HEARTBEAT.md'), heartbeatContent, 'utf-8');

  // Generate .env
  const envLines: string[] = [
    `# Adytum Configuration — Generated ${new Date().toISOString()}`,
    `ADYTUM_AGENT_NAME=${agentName}`,
    `ADYTUM_USER_NAME=${userName}`,
    `ADYTUM_USER_ROLE=${userRole}`,
    `GATEWAY_PORT=3001`,
    `LITELLM_PORT=4000`,
    `DASHBOARD_PORT=3000`,
    '',
  ];

  for (const m of models) {
    if (m.apiKey) {
      const envKey = `${m.provider.toUpperCase()}_API_KEY`;
      envLines.push(`${envKey}=${m.apiKey}`);
    }
  }
  writeFileSync(join(projectRoot, '.env'), envLines.join('\n'), 'utf-8');

  // Generate adytum.config.yaml
  const yamlConfig = {
    agentName,
    userName,
    userRole,
    userPreferences: userPreferences || undefined,
    workspacePath: './workspace',
    dataPath: './data',
    models: models.map((m) => ({
      role: m.role,
      provider: m.provider,
      model: m.model,
      baseUrl: m.baseUrl,
    })),
    litellmPort: 4000,
    gatewayPort: 3001,
    dashboardPort: 3000,
    contextSoftLimit: 40000,
    heartbeatIntervalMinutes: 30,
    skills: {
      enabled: true,
      allow: [],
      deny: [],
      load: { paths: [] },
      entries: {},
    },
  };
  writeFileSync(
    join(projectRoot, 'adytum.config.yaml'),
    stringifyYaml(yamlConfig),
    'utf-8',
  );

  // Generate litellm_config.yaml
  const litellmConfig = {
    model_list: models.map((m) => ({
      model_name: m.role,
      litellm_params: {
        model: m.provider === 'ollama' ? `ollama/${m.model}` : `${m.provider}/${m.model}`,
        ...(m.apiKey ? { api_key: `os.environ/${m.provider.toUpperCase()}_API_KEY` } : {}),
        ...(m.baseUrl ? { api_base: m.baseUrl } : {}),
      },
    })),
  };
  writeFileSync(
    join(projectRoot, 'litellm_config.yaml'),
    stringifyYaml(litellmConfig),
    'utf-8',
  );

  // ── Final Message ───────────────────────────────────────
  console.log();
  console.log(gradient.vice('─'.repeat(50)));
  console.log();

  const heartbeat = chalk.red('♥');
  await typewrite(chalk.cyan.bold(
    `"I am ${agentName}. ${heartbeat} I remember everything. Let's begin."`,
  ));

  console.log();
  console.log(chalk.dim('─'.repeat(50)));
  console.log(chalk.green('✓ ') + chalk.white('Soul written to ') + chalk.cyan('workspace/SOUL.md'));
  console.log(chalk.green('✓ ') + chalk.white('Config saved to ') + chalk.cyan('adytum.config.yaml'));
  console.log(chalk.green('✓ ') + chalk.white('Environment saved to ') + chalk.cyan('.env'));
  console.log(chalk.green('✓ ') + chalk.white('LiteLLM config saved to ') + chalk.cyan('litellm_config.yaml'));
  console.log();
  console.log(chalk.yellow('Next: Run ') + chalk.bold.white('adytum start') + chalk.yellow(' to wake me up.'));
  console.log();
}

/** Typewriter effect for dramatic agent speech. */
async function typewrite(text: string, speed: number = 30): Promise<void> {
  for (const char of text) {
    process.stdout.write(char);
    await sleep(speed);
  }
  process.stdout.write('\n');
}
