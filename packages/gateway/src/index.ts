import { v4 as uuid } from 'uuid';
import chalk from 'chalk';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { watch, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadConfig } from './config.js';
import { GatewayServer } from './server.js';
import { AgentRuntime } from './agent/runtime.js';
import { ModelRouter } from './agent/model-router.js';
import { ModelCatalog } from './agent/model-catalog.js';

import { SoulEngine } from './agent/soul-engine.js';
import { SkillLoader } from './agent/skill-loader.js';
import { ToolRegistry } from './tools/registry.js';
import { createShellTool, createShellToolWithApproval } from './tools/shell.js';
import { createFileSystemTools } from './tools/filesystem.js';
import { createWebFetchTool } from './tools/web-fetch.js';
import { createMemoryTools } from './tools/memory.js';
import { createPersonalityTools } from './tools/personality.js';
import { PermissionManager } from './security/permission-manager.js';
import { SecretsStore } from './security/secrets-store.js';
import { tokenTracker } from './agent/token-tracker.js';
import { autoProvisionStorage } from './storage/provision.js';
import { MemoryStore } from './agent/memory-store.js';
import { MemoryDB } from './agent/memory-db.js';
import { Dreamer } from './agent/dreamer.js';
import { InnerMonologue } from './agent/inner-monologue.js';
import { HeartbeatManager } from './agent/heartbeat-manager.js';
import { CronManager } from './agent/cron-manager.js';
import { createCronTools } from './tools/cron.js';
import cron from 'node-cron';

// ─── Direct Execution Detection ─────────────────────────────
// If this file is run directly (e.g. `node dist/index.js start`),
// delegate to the CLI entry point which uses Commander.
import { resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const entryFile = process.argv[1] ? resolve(process.argv[1]) : '';

if (entryFile === __filename) {
  // Dynamically import the CLI which parses process.argv via Commander
  import('./cli/index.js').catch((err) => {
    console.error(chalk.red('\n  ❌ Fatal error:'), err.message || err);
    if (process.env.DEBUG) console.error(err);
    process.exit(1);
  });
}

/** Start the full Adytum gateway with terminal CLI. */
export async function startGateway(projectRoot: string): Promise<void> {
  const config = loadConfig(projectRoot);

  console.log(chalk.dim(`\n  Starting ${config.agentName}...\n`));

  // ── Storage Auto-Provisioning ─────────────────────────────
  const dbResult = await autoProvisionStorage(config);
  console.log(chalk.green('  ✓ ') + chalk.white(`Storage: ${dbResult.type}`));

  // ── Security Layer ────────────────────────────────────────
  const permissionManager = new PermissionManager(config.workspacePath, config.dataPath);
  permissionManager.startWatching();
  const secretsStore = new SecretsStore(config.dataPath);

  // ── Tool Registry ─────────────────────────────────────────
  const toolRegistry = new ToolRegistry();

  const shellTool = createShellTool(async (_command) => {
    // Placeholder — will be re-wired after REPL is created
    return { approved: false, reason: 'bootstrap', mode: 'ask' };
  });
  toolRegistry.register(shellTool);

  for (const fsTool of createFileSystemTools(permissionManager)) {
    toolRegistry.register(fsTool);
  }

  toolRegistry.register(createWebFetchTool());

  // ── Memory Store & Tools ───────────────────────────────────
  const memoryDb = new MemoryDB(config.dataPath);
  const memoryStore = new MemoryStore(memoryDb);
  for (const memTool of createMemoryTools(memoryStore)) {
    toolRegistry.register(memTool);
  }

  for (const pTool of createPersonalityTools(memoryDb)) {
    toolRegistry.register(pTool);
  }

  // ─── Agent Runtime ─────────────────────────────────────────
  const modelCatalog = new ModelCatalog(config);

  const modelRouter = new ModelRouter({
    litellmBaseUrl: `http://localhost:${config.litellmPort}/v1`,
    models: config.models,
    modelChains: config.modelChains,
    taskOverrides: config.taskOverrides,
    modelCatalog,
    routing: config.routing,
  });


  // Detect LiteLLM vs direct API mode
  const llmStatus = await modelRouter.initialize();
  console.log(chalk.green('  ✓ ') + chalk.white(`LLM: ${llmStatus}`));

  const soulEngine = new SoulEngine(config.workspacePath);
  const skillLoader = new SkillLoader(config.workspacePath, {
    projectRoot,
    dataPath: config.dataPath,
    config,
  });
  skillLoader.setSecrets(secretsStore.getAll());
  await skillLoader.init(toolRegistry);

  const agent = new AgentRuntime({
    modelRouter,
    toolRegistry,
    soulEngine,
    skillLoader,
    contextSoftLimit: config.contextSoftLimit,
    maxIterations: 20,
    defaultModelRole: 'thinking',
    agentName: config.agentName,
    workspacePath: config.workspacePath,
    memoryStore,
    memoryTopK: 3,
    memoryDb,
  });

  // Seed context with recent persisted messages to restore short-term memory
  const recentMessages = memoryDb.getRecentMessages(40);
  agent.seedContext(recentMessages.map((m) => ({ role: m.role as any, content: m.content })));
  await skillLoader.start(agent);

  const reloadSkills = async (): Promise<void> => {
    const latestConfig = loadConfig(projectRoot);
    skillLoader.updateConfig(latestConfig, projectRoot);
    skillLoader.setSecrets(secretsStore.getAll());
    await skillLoader.reload(agent);
    agent.refreshSystemPrompt();
  };

  // Auto-reload skills when files change under workspace/skills
  const skillsPath = resolve(config.workspacePath, 'skills');
  const startSkillsWatcher = () => {
    if (!existsSync(skillsPath)) return;
    let timer: NodeJS.Timeout | null = null;
    const debounceReload = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        try {
          console.log(chalk.dim('  [Skills] Change detected → reloading skills...'));
          await reloadSkills();
        } catch (err: any) {
          console.error(chalk.red(`  [Skills] Reload failed: ${err?.message || err}`));
        }
      }, 400);
    };

    watch(skillsPath, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      debounceReload();
    });
  };
  startSkillsWatcher();

  // One-time migration: move known skill env vars into secrets store, then reload if changed.
  const migrateSkillEnvs = async () => {
    let changed = false;
    for (const skill of skillLoader.getAll()) {
      const meta = skill.manifest?.metadata;
      const required = [
        ...(meta?.requires?.env || []),
        meta?.primaryEnv,
      ].filter((v): v is string => Boolean(v));
      for (const envName of required) {
        if (process.env[envName] && !secretsStore.getAll()[skill.id]?.[envName]) {
          secretsStore.setSkillSecret(skill.id, envName, process.env[envName] as string);
          changed = true;
        }
      }
    }
    if (changed) {
      skillLoader.setSecrets(secretsStore.getAll());
      await skillLoader.reload(agent);
    }
  };
  await migrateSkillEnvs();

  // ── Dreamer & Inner Monologue (Phase 3/4) ─────────────────
  const dreamer = new Dreamer(modelRouter, memoryDb, memoryStore, soulEngine, config.dataPath, config.workspacePath);
  const monologue = new InnerMonologue(modelRouter, memoryDb, memoryStore);
  const heartbeatManager = new HeartbeatManager(agent, config.workspacePath);

  // Managed cron tasks for dreamer and monologue (restartable)
  let dreamerTask: cron.ScheduledTask | null = null;
  let monologueTask: cron.ScheduledTask | null = null;

  function scheduleDreamer(minutes: number) {
    dreamerTask?.stop();
    const safe = Math.max(1, Math.floor(minutes));
    const expr = safe < 60 ? `*/${safe} * * * *` : `0 */${Math.floor(safe / 60)} * * *`;
    console.log(chalk.dim(`  [Dreamer] Scheduling every ${safe}m → ${expr}`));
    dreamerTask = cron.schedule(expr, async () => {
      try { await dreamer.run(); } catch (err) { if (process.env.DEBUG) console.error(err); }
    });
  }

  function scheduleMonologue(minutes: number) {
    monologueTask?.stop();
    const safe = Math.max(1, Math.floor(minutes));
    const expr = safe < 60 ? `*/${safe} * * * *` : `0 */${Math.floor(safe / 60)} * * *`;
    console.log(chalk.dim(`  [Monologue] Scheduling every ${safe}m → ${expr}`));
    monologueTask = cron.schedule(expr, async () => {
      try { await monologue.run(); } catch (err) { if (process.env.DEBUG) console.error(err); }
    });
  }

  scheduleDreamer(config.dreamerIntervalMinutes);
  scheduleMonologue(config.monologueIntervalMinutes);

  const cronManager = new CronManager(agent, config.dataPath);

  // Register Cron Tools (needs agent instance)
  for (const tool of createCronTools(cronManager)) {
    toolRegistry.register(tool);
  }
  console.log(chalk.green('  ✓ ') + chalk.white(`Tools: ${toolRegistry.getAll().length} registered`));
  agent.refreshSystemPrompt();
  
  // Start Heartbeat Scheduler
  heartbeatManager.start(config.heartbeatIntervalMinutes);

  console.log(chalk.green('  ✓ ') + chalk.white(`Agent: ${config.agentName} loaded`));

  // ── Gateway Server ────────────────────────────────────────
  const server = new GatewayServer({
    port: config.gatewayPort,
    host: '127.0.0.1',
    permissionManager,
    workspacePath: config.workspacePath,
    heartbeatManager,
    cronManager,
    skillLoader,
    toolRegistry,
    memoryDb,
    secrets: secretsStore.getAll(),
    secretsStore,
    onScheduleUpdate: (type, intervalMinutes) => {
      if (type === 'dreamer') scheduleDreamer(intervalMinutes);
      else if (type === 'monologue') scheduleMonologue(intervalMinutes);
    },
    onSkillsReload: reloadSkills,
    onChainsUpdate: (chains) => {
      modelRouter.updateChains(chains);
    },
    onRoutingUpdate: (routing) => {
      modelRouter.updateRouting(routing);
    },
    modelCatalog,
  });


  // Route WebSocket messages to agent
  server.on('frame', async ({ sessionId, frame }) => {
    if (frame.type === 'message') {
      const result = await agent.run(frame.content, sessionId, {
        modelRole: frame.modelRole,
        modelId: frame.modelId,
      });
      server.sendToSession(sessionId, {
        type: 'message',
        sessionId,
        content: result.response,
      });
    }
  });

  // Stream agent events to WebSocket clients
  agent.on('stream', (event) => {
    server.broadcastToAll({
      type: 'stream',
      ...event,
    });
  });

  await server.start();
  console.log(chalk.green('  ✓ ') + chalk.white(`Gateway: http://localhost:${config.gatewayPort}`));

  console.log(chalk.dim('\n  ─────────────────────────────────────'));
  console.log(chalk.cyan(`  ${config.agentName} is awake. Type your message below.`));
  console.log(chalk.dim(`  Type "exit" to stop. Type "/clear" to reset context.`));
  console.log(chalk.dim('  ─────────────────────────────────────\n'));

  // ── Terminal REPL ─────────────────────────────────────────
  const sessionId = uuid();
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.blue(`  ${config.agentName} > `),
    terminal: true,
  });

  // Graceful shutdown on Ctrl+C
  const shutdown = async () => {
    console.log(chalk.dim(`\n  ${config.agentName} is resting. Goodbye.\n`));
    rl.close();
    permissionManager.stopWatching();
    await skillLoader.stop();
    await server.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Shared approval prompt that pauses/resumes the main REPL
  // to prevent double character echo
  const promptApproval = async (promptText: string): Promise<boolean> => {
    rl.pause();
    // Remove the main readline from stdin so it doesn't intercept keys
    process.stdin.setRawMode?.(false);

    return new Promise((resolve) => {
      const approvalRl = createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true,
      });
      approvalRl.question(promptText, (answer) => {
        approvalRl.close();
        rl.resume();
        resolve(answer.toLowerCase() === 'y');
      });
    });
  };

  // Re-wire the shell tool's approval callback to respect execution permissions and dashboard approvals
  toolRegistry.get('shell_execute')!.execute = createShellToolWithApproval(async (command) => {
    const latestConfig = loadConfig(projectRoot);
    const mode = latestConfig.execution?.shell || 'ask';
    const defaultChannel = latestConfig.execution?.defaultChannel;
    const defaultCommSkillId = latestConfig.execution?.defaultCommSkillId;

    if (mode === 'deny') {
      return { approved: false, mode, reason: 'policy_denied', defaultChannel, defaultCommSkillId };
    }

    if (mode === 'auto') {
      return { approved: true, mode, defaultChannel, defaultCommSkillId };
    }

    // mode === 'ask'
    console.log(chalk.yellow(`  ⚠ shell approval required: ${command}`));
    const approved = await server.requestApproval({
      kind: 'shell',
      description: `shell_execute wants to run: ${command}`,
      meta: { command, defaultChannel, defaultCommSkillId },
    });

    if (approved !== undefined) {
      return { approved, mode, reason: approved ? undefined : 'user_denied', defaultChannel, defaultCommSkillId };
    }

    if (process.stdin.isTTY) {
      const ttyApproved = await promptApproval(
        chalk.yellow(
          `\n  ⚠  Tool "shell_execute" wants to execute: ${chalk.bold(JSON.stringify({ command }))}\n  Approve? [y/N]: `,
        ),
      );
      return { approved: ttyApproved, mode, reason: ttyApproved ? undefined : 'user_denied', defaultChannel, defaultCommSkillId };
    }

    return {
      approved: false,
      mode,
      reason: 'approval_required',
      defaultChannel,
      defaultCommSkillId,
      message: 'Command cancelled by user request. You may try again if necessary.',
    };
  });

  // Re-wire the agent's approval callback too (used by tools marked requiresApproval)
  agent.setApprovalHandler(async (description) => {
    const approved = await server.requestApproval({
      kind: 'tool',
      description,
    });
    if (approved !== undefined) return approved;
    return promptApproval(
      chalk.yellow(`\n  ⚠  ${description}\n  Approve? [y/N]: `),
    );
  });

  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();

    if (!input) {
      rl.prompt();
      return;
    }

    if (input.toLowerCase() === 'exit') {
      console.log(chalk.dim(`\n  ${config.agentName} is resting. Goodbye.\n`));
      permissionManager.stopWatching();
      await skillLoader.stop();
      await server.stop();
      process.exit(0);
    }

    if (input === '/clear') {
      agent.resetContext();
      console.log(chalk.dim('  Context cleared.\n'));
      rl.prompt();
      return;
    }

    if (input === '/status') {
      const usage = tokenTracker.getTotalUsage();
      console.log(chalk.dim(`  Tokens: ${usage.tokens} | Cost: $${usage.cost.toFixed(4)} | Connections: ${server.getConnectionCount()}`));
      rl.prompt();
      return;
    }

    if (input === '/reload') {
      try {
        await reloadSkills();
        console.log(chalk.dim('  SOUL.md and skills reloaded.\n'));
      } catch (err: any) {
        console.log(chalk.red(`  Failed to reload skills: ${err?.message || err}\n`));
      }
      rl.prompt();
      return;
    }

    try {
      // Pause REPL while agent is processing to avoid stdin conflicts
      rl.pause();

      // Show thinking indicator
      process.stdout.write(chalk.dim('  thinking...\r'));

      const result = await agent.run(input, sessionId);

      // Clear thinking indicator and show response
      process.stdout.write('               \r');
      console.log();
      console.log(chalk.white('  ' + result.response.split('\n').join('\n  ')));
      console.log();

      if (result.toolCalls.length > 0) {
        console.log(chalk.dim(`  [${result.toolCalls.length} tool calls | trace: ${result.trace.id.slice(0, 8)}]`));
      }

      const usage = tokenTracker.getSessionUsage(sessionId);
      console.log(chalk.dim(`  [tokens: ${usage.tokens} | cost: $${usage.cost.toFixed(4)}]`));
      console.log();
    } catch (error: any) {
      console.log(chalk.red(`  Error: ${error.message}\n`));
    }

    // Resume REPL after processing
    rl.resume();
    rl.prompt();
  });

  rl.on('close', async () => {
    permissionManager.stopWatching();
    await skillLoader.stop();
    await server.stop();
    process.exit(0);
  });
}
