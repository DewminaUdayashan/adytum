import { v4 as uuid } from 'uuid';
import chalk from 'chalk';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { GatewayServer } from './server.js';
import { AgentRuntime } from './agent/runtime.js';
import { ModelRouter } from './agent/model-router.js';
import { SoulEngine } from './agent/soul-engine.js';
import { SkillLoader } from './agent/skill-loader.js';
import { ToolRegistry } from './tools/registry.js';
import { createShellTool, createShellToolWithApproval } from './tools/shell.js';
import { createFileSystemTools } from './tools/filesystem.js';
import { createWebFetchTool } from './tools/web-fetch.js';
import { PermissionManager } from './security/permission-manager.js';
import { tokenTracker } from './agent/token-tracker.js';
import { auditLogger } from './security/audit-logger.js';
import { autoProvisionStorage } from './storage/provision.js';
import type { AdytumConfig } from '@adytum/shared';

// ─── Direct Execution Detection ─────────────────────────────
// If this file is run directly (e.g. `node dist/index.js start`),
// delegate to the CLI entry point which uses Commander.
import { resolve, dirname } from 'node:path';

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

  // ── Tool Registry ─────────────────────────────────────────
  const toolRegistry = new ToolRegistry();

  const shellTool = createShellTool(async (_command) => {
    // Placeholder — will be re-wired after REPL is created
    return false;
  });
  toolRegistry.register(shellTool);

  for (const fsTool of createFileSystemTools(permissionManager)) {
    toolRegistry.register(fsTool);
  }

  toolRegistry.register(createWebFetchTool());

  console.log(chalk.green('  ✓ ') + chalk.white(`Tools: ${toolRegistry.getAll().length} registered`));

  // ── Agent Runtime ─────────────────────────────────────────
  const modelRouter = new ModelRouter({
    litellmBaseUrl: `http://localhost:${config.litellmPort}/v1`,
    models: config.models,
  });

  // Detect LiteLLM vs direct API mode
  const llmStatus = await modelRouter.initialize();
  console.log(chalk.green('  ✓ ') + chalk.white(`LLM: ${llmStatus}`));

  const soulEngine = new SoulEngine(config.workspacePath);
  const skillLoader = new SkillLoader(config.workspacePath);

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
  });

  console.log(chalk.green('  ✓ ') + chalk.white(`Agent: ${config.agentName} loaded`));

  // ── Gateway Server ────────────────────────────────────────
  const server = new GatewayServer({
    port: config.gatewayPort,
    host: '127.0.0.1',
    permissionManager,
    workspacePath: config.workspacePath,
  });

  // Route WebSocket messages to agent
  server.on('frame', async ({ sessionId, frame }) => {
    if (frame.type === 'message') {
      const result = await agent.run(frame.content, sessionId);
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

  // Re-wire the shell tool's approval callback to use the shared prompt
  toolRegistry.get('shell_execute')!.execute = createShellToolWithApproval(
    async (command) => {
      return promptApproval(
        chalk.yellow(`\n  ⚠  Tool "shell_execute" wants to execute: ${chalk.bold(JSON.stringify({ command }))}\n  Approve? [y/N]: `),
      );
    },
  );

  // Re-wire the agent's approval callback too
  agent.setApprovalHandler(async (description) => {
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
      agent.refreshSystemPrompt();
      console.log(chalk.dim('  SOUL.md and skills reloaded.\n'));
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
    await server.stop();
    process.exit(0);
  });
}
