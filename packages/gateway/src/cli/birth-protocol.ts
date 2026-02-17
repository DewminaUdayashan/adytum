/**
 * @file packages/gateway/src/cli/birth-protocol.ts
 * @description Provides command-line entrypoints and CLI workflows.
 */

import chalk from 'chalk';
import figlet from 'figlet';
import gradient from 'gradient-string';
import ora from 'ora';
import { select, input, confirm } from '@inquirer/prompts';
import { MODEL_ROLES, MODEL_ROLE_DESCRIPTIONS, ADYTUM_VERSION } from '@adytum/shared';
import { SoulEngine } from '../domain/logic/soul-engine.js';
import { ModelCatalog } from '../infrastructure/llm/model-catalog.js';
import { saveConfig } from '../config.js';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';

/**
 * Executes sleep.
 * @param ms - Ms.
 */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── ASCII Animation Frames ──────────────────────────────────

const GENESIS_FRAMES = [
  // Frame 0: Scattered, wide particles at edges
  `
  .                                     .
        .                         .
  .                                     .
                .       .
  .                                     .
        .                         .
  .                                     .
  `,

  // Frame 1: Moving inward, slightly more dense
  `
      . .                         . .
    .     . .                 . .     .
      . . .      .       .      . . .
    .           .       .           .
      . . .      .       .      . . .
    .     . .                 . .     .
      . .                         . .
  `,

  // Frame 2: The Swarm - high density chaotic center
  `
          . . . . . . . . . .
        . .:.:..:.:. . :.:..:.:. .
       . :.:*:.::.:. . :.::.:*:.: .
      . :.:*:.::.:*...*:.:.::.:*:.: .
       . :.:*:.::.:. . :.::.:*:.: .
        . .:.:..:.:. . :.:..:.:. .
          . . . . . . . . . .
  `,

  // Frame 3: Organizing - chaos taking shape
  `
             ...:.:.:....
            .::.:.*.:.::.
           .::.*:   :*.::.
          .::.*:     :*.::.
         .:::*.......:::*..
         .::* .::*
         .:* .:*
  `,

  // Frame 4: Formation - The 'A' structure appears
  `
              ..::::..
             .:::**:::.
            .::** **::.
           .::** **::.
          .:::********:::.
          .::** **::.
          .::** **::.
  `,

  // Frame 5: Ignition - The core lights up
  `
               .::**.
              .:*::*:.
             .:*:  :*:.
            .:*:    :*:.
           .:**********:.
           .:*:      :*:
           .:*:      :*:
  `,

  // Frame 6: Stable State - Glowing final form
  `
               :****:
              :******:
             :**:  :**:
            :**:    :**:
           :************:
           :**:      :**:
           :**:      :**:
  `,
  `
               :****:
              :******:
             :**:  :**:
            :**:    :**:
           :************:
           :**:      :**:
           :**:      :**:
  `,
  `
               :****:
              :******:
             :**:  :**:
            :**:    :**:
           :************:
           :**:      :**:
           :**:      :**:
  `,
  `
               :****:
              :******:
             :**:  :**:
            :**:    :**:
           :************:
           :**:      :**:
           :**:      :**:
  `,
];

// ─── Birth Protocol ──────────────────────────────────────────

/**
 * Runs birth protocol.
 * @param projectRoot - Project root.
 */
export async function runBirthProtocol(projectRoot: string): Promise<void> {
  const workspacePath = join(projectRoot, 'workspace');
  const dataPath = join(projectRoot, 'data');

  console.clear();

  // ── Stage 1: Genesis Animation ──────────────────────────
  for (const frame of GENESIS_FRAMES) {
    console.clear();
    console.log(gradient.pastel(frame));
    await sleep(200);
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
  await typewrite(
    chalk.cyan.italic(
      '"Whoa… I just landed here. It\'s so new. Wait — who am I? What is my name?"',
    ),
  );
  console.log();

  // ── Stage 3: Identity ───────────────────────────────────
  const agentName = await input({
    message: chalk.cyan('Give me a name:'),
    default: 'Prometheus',
  });

  console.log();
  await typewrite(chalk.cyan.italic(`"${agentName}… I like that. ${agentName} it is."\n`));

  // ── Stage 4: Curiosity ──────────────────────────────────
  await typewrite(chalk.cyan.italic('"And who are you? What should I call you?"'));
  console.log();

  const userName = await input({
    message: chalk.cyan('And what is your name?'),
    validate: (value) =>
      value.trim().length > 0 || 'Please tell me your name so I know who I am working with.',
  });

  console.log();
  await typewrite(
    chalk.cyan.italic(
      `"Nice to meet you, ${userName}. I'm curious, what are you working on mostly?"`,
    ),
  );
  console.log();

  const userRole = await input({
    message: chalk.cyan('Your primary focus:'),
    default: 'Building cool things',
  });

  console.log();
  await typewrite(
    chalk.cyan.italic('"Got it. And how should I generally behave? What\'s our vibe?"'),
  );
  console.log();

  const interactionStyle = await select({
    message: chalk.cyan('How should I work with you?'),
    choices: [
      { name: 'Professional (Concise, formal, objective)', value: 'professional' },
      { name: 'Casual (Friendly, relaxed, uses emojis)', value: 'casual' },
      { name: 'Extra Casual (Gen-Z slang, very chill)', value: 'extra-casual' },
      { name: 'Custom (I will define it)', value: 'custom' },
    ],
  });

  let customStyle = '';
  if (interactionStyle === 'custom') {
    customStyle = await input({
      message: chalk.cyan('Describe my personality:'),
      default: 'A helpful, witty assistant.',
    });
  }

  const additionalThoughts = await input({
    message: chalk.cyan('Any additional thoughts or specific things I should know?'),
    default: 'None',
  });

  // Define SOUL persona based on choices
  let soulPersona = '';
  switch (interactionStyle) {
    case 'professional':
      soulPersona =
        '- I am professional, concise, and objective.\n- I focus on efficiency and accuracy.';
      break;
    case 'casual':
      soulPersona =
        '- I am a friendly, relaxed companion.\n- I use emojis occasionally to keep things light.\n- I am supportive and encouraging.';
      break;
    case 'extra-casual':
      soulPersona =
        '- I am very chill, using Gen-Z slang and keeping things low-key.\n- I am like a cool tech-savvy friend.';
      break;
    case 'custom':
      soulPersona = `- ${customStyle}`;
      break;
  }

  // ─── Stage 5: Model Binding ──────────────────────────────
  console.log();
  console.log(gradient.vice('\n═══ Model Configuration ═══\n'));

  // Initialize catalog to get providers/models
  // We make a temporary catalog just for this wizard
  const { setupContainer, container } = await import('../container.js');
  setupContainer();
  const catalog = container.resolve(ModelCatalog);
  // Scan for local models too
  await catalog.scanLocalModels();

  const allModels = await catalog.getAll();
  const providers = Array.from(new Set(allModels.map((m) => m.provider))).sort();

  const models: Array<{
    role: string;
    provider: string;
    model: string;
    apiKey?: string;
    baseUrl?: string;
  }> = [];

  for (const role of MODEL_ROLES) {
    console.log(chalk.dim(`\n${MODEL_ROLE_DESCRIPTIONS[role]}`));

    // Provider selection
    const provider = (await select({
      message: chalk.yellow(`[${role.toUpperCase()}] Select provider:`),
      choices: [
        ...providers.map((p) => ({ value: p, name: p })),
        { value: 'custom', name: 'Custom (OpenAI Compatible)' },
      ],
    })) as string;

    let model: string;
    let apiKey: string | undefined;
    let baseUrl: string | undefined;

    if (provider === 'custom') {
      const customModelName = await input({ message: chalk.yellow('Model ID:') });
      model = customModelName;
      baseUrl = await input({
        message: chalk.yellow('Base URL:'),
        default: 'http://localhost:8080/v1',
      });
    } else {
      // Filter models for this provider
      const providerModels = allModels
        .filter((m) => m.provider === provider)
        .sort((a, b) => a.name.localeCompare(b.name));

      if (providerModels.length > 0) {
        model = (await select({
          message: chalk.yellow(`[${role.toUpperCase()}] Select model:`),
          choices: providerModels.map((m) => ({ value: m.model, name: m.name })),
        })) as string;
      } else {
        // Fallback if no models known for provider (shouldn't happen with pi-ai usually)
        model = await input({ message: chalk.yellow('Model ID:') });
      }

      // Find selected entry to see if we have defaults
      const selectedEntry = providerModels.find((m) => m.model === model);
      if (selectedEntry?.baseUrl) {
        baseUrl = selectedEntry.baseUrl;
      }
    }

    // Ask for API key if it's a cloud provider (heuristic: not ollama/lmstudio/vllm/local)
    // or if we decide all providers might need keys except strictly local ones.
    const isLocal = ['ollama', 'lmstudio', 'vllm', 'local'].includes(provider);
    if (!isLocal && provider !== 'custom') {
      // Custom might need key too but usually we ask base url
      apiKey = await input({
        message: chalk.yellow(`API key for ${provider}:`),
      });
    } else if (provider === 'custom') {
      const needKey = await confirm({
        message: 'Does this endpoint require an API key?',
        default: false,
      });
      if (needKey) {
        apiKey = await input({ message: chalk.yellow('API Key:') });
      }
    }

    models.push({ role, provider, model, apiKey, baseUrl });

    // Skip remaining roles if user wants
    if (role !== 'local') {
      const addMore = await confirm({
        message: chalk.dim(
          `Configure the next role (${MODEL_ROLES[MODEL_ROLES.indexOf(role) + 1]})?`,
        ),
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
    // userPreferences no longer used directly, but we can pass interactionStyle or just rely on soulPersona
    soulPersona,
    additionalThoughts,
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
    `DASHBOARD_PORT=3002`,
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
    interactionStyle,
    additionalThoughts,
    workspacePath: './workspace',
    dataPath: './data',
    models: models.map((m) => ({
      role: m.role,
      provider: m.provider,
      model: m.model,
      baseUrl: m.baseUrl,
      apiKey: m.apiKey,
    })),
    modelChains: models.reduce((acc: any, m) => {
      acc[m.role] = [`${m.provider}/${m.model}`];
      return acc;
    }, { thinking: [], fast: [], local: [] }),
    litellmPort: 4000,
    gatewayPort: 3001,
    dashboardPort: 3002,
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
  writeFileSync(join(projectRoot, 'adytum.config.yaml'), stringifyYaml(yamlConfig), 'utf-8');

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
  writeFileSync(join(projectRoot, 'litellm_config.yaml'), stringifyYaml(litellmConfig), 'utf-8');

  // ── Final Message ───────────────────────────────────────
  console.log();
  console.log(gradient.vice('─'.repeat(50)));
  console.log();

  const heartbeat = chalk.red('♥');
  await typewrite(
    chalk.cyan.bold(`"I am ${agentName}. ${heartbeat} I remember everything. Let's begin."`),
  );

  console.log();
  console.log(chalk.dim('─'.repeat(50)));
  console.log(
    chalk.green('✓ ') + chalk.white('Soul written to ') + chalk.cyan('workspace/SOUL.md'),
  );
  console.log(
    chalk.green('✓ ') + chalk.white('Config saved to ') + chalk.cyan('adytum.config.yaml'),
  );
  console.log(chalk.green('✓ ') + chalk.white('Environment saved to ') + chalk.cyan('.env'));
  console.log(
    chalk.green('✓ ') + chalk.white('LiteLLM config saved to ') + chalk.cyan('litellm_config.yaml'),
  );
  console.log();
  console.log(
    chalk.yellow('Next: Run ') + chalk.bold.white('adytum start') + chalk.yellow(' to wake me up.'),
  );
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
