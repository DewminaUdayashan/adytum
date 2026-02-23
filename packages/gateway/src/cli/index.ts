#!/usr/bin/env node

/**
 * @file packages/gateway/src/cli/index.ts
 * @description Provides command-line entrypoints and CLI workflows.
 */

import 'reflect-metadata';
import { Command } from 'commander';
import chalk from 'chalk';
import { ADYTUM_VERSION } from '@adytum/shared';
import { runBirthProtocol } from './birth-protocol.js';
import { existsSync, rmSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { confirm } from '@inquirer/prompts';
import { ModelCatalog } from '../infrastructure/llm/model-catalog.js';
import { spawn, execSync } from 'node:child_process';
import open from 'open';
// No unnecessary imports

const findProjectRoot = (startDir: string): string => {
  let curr = startDir;
  while (curr !== dirname(curr)) {
    if (existsSync(join(curr, 'adytum.config.yaml'))) return curr;
    if (existsSync(join(curr, 'package.json')) && !basename(curr).match(/gateway|dashboard/)) {
      if (existsSync(join(curr, 'workspace'))) return curr;
    }
    curr = dirname(curr);
  }
  return startDir;
};

const program = new Command();

program
  .name('adytum')
  .description('Adytum — Self-hosted autonomous AI assistant')
  .version(ADYTUM_VERSION);

// ─── adytum init ──────────────────────────────────────────────
program
  .command('init')
  .description('Initialize a new Adytum agent (Birth Protocol)')
  .action(async () => {
    const projectRoot = process.cwd();

    // Check if already initialized
    if (existsSync(join(projectRoot, 'adytum.config.yaml'))) {
      const reset = await confirm({
        message:
          'Adytum is already initialized in this directory. Do you want to reset all settings and start over?',
        default: false,
      });

      if (!reset) {
        console.log(chalk.dim('\n   Run `adytum start` to start the agent.'));
        return;
      }

      console.log(
        chalk.yellow('\n⚠  Starting over... Existing configuration will be overwritten.\n'),
      );

      // Cleanup persist data
      try {
        const dataPath = join(projectRoot, 'data');
        if (existsSync(dataPath)) {
          rmSync(dataPath, { recursive: true, force: true });
          console.log(chalk.dim('   ✓ Cleared data/ directory (memory, logs, cron jobs)'));
        }
        const configPath = join(projectRoot, 'adytum.config.yaml');
        if (existsSync(configPath)) {
          rmSync(configPath, { force: true });
          console.log(chalk.dim('   ✓ Removed adytum.config.yaml'));
        }
        const litellmPath = join(projectRoot, 'litellm_config.yaml');
        if (existsSync(litellmPath)) {
          rmSync(litellmPath, { force: true });
          console.log(chalk.dim('   ✓ Removed litellm_config.yaml'));
        }
        const envPath = join(projectRoot, '.env');
        if (existsSync(envPath)) {
          rmSync(envPath, { force: true });
          console.log(chalk.dim('   ✓ Removed .env'));
        }
      } catch {
        // Ignore cleanup errors
      }
    }

    await runBirthProtocol(projectRoot);
  });

// ─── adytum start ─────────────────────────────────────────────
program
  .command('start')
  .description('Start the Adytum gateway and dashboard')
  .option('--no-browser', 'Do not open the dashboard in the browser')
  .action(async (options) => {
    const workspaceRoot = process.cwd();

    if (!existsSync(join(workspaceRoot, 'adytum.config.yaml'))) {
      console.log(chalk.red('✗  No adytum.config.yaml found.'));
      console.log(chalk.dim('   Run `adytum init` first to set up your agent.\n'));
      process.exit(1);
    }

    // Find the project root relative to this script, not just cwd
    const scriptDir = dirname(fileURLToPath(import.meta.url));
    const sourceRoot = findProjectRoot(scriptDir);

    // Check if built
    if (!existsSync(join(sourceRoot, 'packages/gateway/dist/index.js'))) {
      console.log(chalk.yellow('⚠  Project not built. Running build first...'));
      try {
        execSync('npm run build', { stdio: 'inherit', cwd: sourceRoot });
      } catch {
        console.error(chalk.red('❌ Build failed. Please run `npm run build` manually.'));
        process.exit(1);
      }
    }

    console.log(chalk.cyan('\n🚀 Launching Adytum Ecosystem...'));

    // 1. Start Gateway in this process
    try {
      const { startGateway } = await import('../index.js');
      const { loadConfig } = await import('../config.js');
      const config = loadConfig(workspaceRoot);

      // Start Dashboard in background
      const dashboardProcess = spawn('npm', ['run', 'start', '--workspace=packages/dashboard'], {
        cwd: sourceRoot,
        stdio: ['ignore', 'inherit', 'inherit'],
        shell: true,
        detached: true, // Allow killing the entire process group
        env: {
          ...process.env,
          PORT: String(config.dashboardPort),
          GATEWAY_PORT: String(config.gatewayPort),
        },
      });

      dashboardProcess.on('error', (err) => {
        console.error(chalk.red(`\n  ❌ Dashboard failed to start: ${err.message}`));
      });

      // Ensure the child process is killed when the parent exits
      const killDashboard = () => {
        if (dashboardProcess.pid && !dashboardProcess.killed) {
          try {
            // Kill entire process group
            process.kill(-dashboardProcess.pid, 'SIGTERM');
          } catch (e) {
            // ignore
          }
        }
      };

      process.on('exit', killDashboard);
      process.on('SIGINT', () => {
        killDashboard();
        process.exit(0);
      });
      process.on('SIGTERM', () => {
        killDashboard();
        process.exit(0);
      });

      // Open browser after a short delay to let things boot
      if (options.browser !== false) {
        setTimeout(async () => {
          console.log(
            chalk.dim(`\n   Opening dashboard at http://localhost:${config.dashboardPort}...`),
          );
          await open(`http://localhost:${config.dashboardPort}`);
        }, 3000);
      }

      await startGateway(workspaceRoot);
    } catch (err: any) {
      console.error(chalk.red(`\n  ❌ Gateway failed to start: ${err.message}`));
      if (process.env.DEBUG) console.error(err);
      process.exit(1);
    }
  });

// ─── adytum update ────────────────────────────────────────────
program
  .command('update')
  .description('Update Adytum to the latest version')
  .action(async () => {
    // Find the project root relative to this script, not just cwd
    const scriptDir = dirname(fileURLToPath(import.meta.url));
    const projectRoot = findProjectRoot(scriptDir);

    console.log(chalk.cyan('\n🔄 Checking for updates...'));
    console.log(chalk.dim(`   Project root: ${projectRoot}`));

    try {
      console.log(chalk.dim('   Pulling latest changes...'));
      execSync('git pull', { stdio: 'inherit', cwd: projectRoot });

      console.log(chalk.dim('   Installing dependencies...'));
      execSync('npm install', { stdio: 'inherit', cwd: projectRoot });

      console.log(chalk.dim('   Rebuilding project...'));
      execSync('npm run build', { stdio: 'inherit', cwd: projectRoot });

      console.log(chalk.green('\n✓  Adytum updated successfully!'));
      console.log(chalk.dim('   Run `adytum start` to launch the new version.\n'));
    } catch (err: any) {
      console.error(chalk.red(`\n  ❌ Update failed: ${err.message}`));
      process.exit(1);
    }
  });

// ─── adytum status ────────────────────────────────────────────
program
  .command('status')
  .description('Show gateway status, model config, and token usage')
  .action(async () => {
    try {
      const response = await fetch('http://localhost:7431/api/health');
      const data = (await response.json()) as any;
      console.log(chalk.green('●') + chalk.white(' Gateway is alive'));
      console.log(chalk.dim(`  Uptime: ${Math.floor(data.uptime)}s`));
      console.log(chalk.dim(`  Connections: ${data.connections}`));
      console.log(chalk.dim(`  Total tokens: ${data.tokens?.tokens ?? 0}`));
      console.log(chalk.dim(`  Total cost: $${(data.tokens?.cost ?? 0).toFixed(4)}`));
    } catch {
      console.log(chalk.red('●') + chalk.white(' Gateway is not running'));
      console.log(chalk.dim('  Run `adytum start` to start it.'));
    }
  });

// ─── adytum reset ─────────────────────────────────────────────
program
  .command('reset')
  .description('Reset all configurations and data (Danger!)')
  .action(async () => {
    const projectRoot = process.cwd();

    const sure = await confirm({
      message: chalk.red(
        'Are you absolutely sure you want to reset Adytum? This will delete all configuration and memory.',
      ),
      default: false,
    });

    if (!sure) {
      console.log(chalk.dim('  Reset cancelled.'));
      return;
    }

    console.log(chalk.yellow('\n⚠  Resetting Adytum...'));

    try {
      const pathsToCleanup = [
        join(projectRoot, 'adytum.config.yaml'),
        join(projectRoot, '.env'),
        join(projectRoot, 'data'),
        join(projectRoot, 'models.json'),
        join(projectRoot, 'litellm_config.yaml'),
      ];

      for (const p of pathsToCleanup) {
        if (existsSync(p)) {
          rmSync(p, { recursive: true, force: true });
          console.log(chalk.dim(`   ✓ Removed ${p.split('/').pop()}`));
        }
      }

      console.log(chalk.green('\n✓  Adytum has been reset to its initial state.'));
      console.log(chalk.dim('   Run `adytum init` to start fresh.\n'));
    } catch (err: any) {
      console.error(chalk.red(`\n  ❌ Reset failed: ${err.message}`));
    }
  });

// ─── adytum skill install ─────────────────────────────────────
program
  .command('skill')
  .argument('<action>', 'install | list | check | remove')
  .argument('[id]', 'Skill ID (for install or check)')
  .description('Manage agent skills')
  .action(async (action: string, id?: string) => {
    const { SkillLoader } = await import('../application/services/skill-loader.js');
    const { loadConfig } = await import('../config.js');
    const projectRoot = findProjectRoot(process.cwd());
    const config = loadConfig(projectRoot);
    const loader = new SkillLoader(config.workspacePath, {
      projectRoot,
      dataPath: config.dataPath,
      config,
    });
    const { ToolRegistry } = await import('../tools/registry.js');
    await loader.init(new ToolRegistry());

    if (action === 'list') {
      const skills = loader.getAll();
      if (skills.length === 0) {
        console.log(chalk.dim('No skills installed.'));
        return;
      }

      console.log(chalk.bold('Installed Skills:\n'));
      for (const skill of skills) {
        const marker =
          skill.status === 'error'
            ? chalk.red('●')
            : skill.enabled
              ? chalk.green('●')
              : chalk.gray('●');

        const installMarker = (skill.install?.length || 0) > 0 ? chalk.blue(' [installable]') : '';
        console.log(
          `  ${marker} ${chalk.white(skill.name)} ${chalk.dim(`(${skill.id})`)}${installMarker}`,
        );
        if (skill.description) {
          console.log(`    ${chalk.dim(skill.description)}`);
        }
        if (skill.error) {
          console.log(`    ${chalk.red(`Error: ${skill.error}`)}`);
        } else if (!skill.enabled && skill.missing) {
          const missing = [];
          if (skill.missing.bins.length > 0) missing.push(`bins: ${skill.missing.bins.join(', ')}`);
          if (skill.missing.env.length > 0) missing.push(`env: ${skill.missing.env.join(', ')}`);
          if (skill.missing.config.length > 0)
            missing.push(`config: ${skill.missing.config.join(', ')}`);
          console.log(`    ${chalk.yellow(`Missing: ${missing.join('; ')}`)}`);
        }
      }
    } else if (action === 'check') {
      console.log(chalk.bold('\nSkill Diagnostic Check:\n'));
      const results = loader.checkAll();
      for (const res of results) {
        const marker = res.enabled ? chalk.green('✓') : chalk.red('✗');
        console.log(`  ${marker} ${chalk.white(res.id)} [${res.status}]`);
        if (!res.enabled && res.missing) {
          if (res.missing.bins.length > 0)
            console.log(`    ${chalk.dim('Missing Bins:')} ${res.missing.bins.join(', ')}`);
          if (res.missing.env.length > 0)
            console.log(`    ${chalk.dim('Missing Env:')} ${res.missing.env.join(', ')}`);
          if (res.missing.config.length > 0)
            console.log(`    ${chalk.dim('Missing Config:')} ${res.missing.config.join(', ')}`);
        }
        if (res.installable && !res.enabled) {
          console.log(
            `    ${chalk.cyan(`Tip: Run "adytum skill install ${res.id}" to resolve dependencies.`)}`,
          );
        }
      }
    } else if (action === 'install') {
      if (!id) {
        console.log(
          chalk.red('Error: Skill ID required for install. Usage: adytum skill install <id>'),
        );
        return;
      }
      console.log(chalk.cyan(`\n🛠  Running installation for skill: ${id}...`));
      const res = await loader.executeInstallSteps(id);
      if (res.ok) {
        console.log(chalk.green(`✓ Skill ${id} dependencies installed.`));
      } else {
        console.error(chalk.red(`❌ Installation failed: ${res.error}`));
      }
    } else {
      console.log(chalk.dim('Usage: adytum skill list'));
      console.log(chalk.dim('       adytum skill check'));
      console.log(chalk.dim('       adytum skill install <id>'));
    }
  });

// ─── adytum models ────────────────────────────────────────────
program
  .command('models')
  .description('Manage LLM models')
  .argument('[action]', 'list | add | remove | scan', 'list')
  .argument('[model_id]', 'Model ID (e.g. ollama/llama3, anthropic/claude-3-opus)')
  .action(async (action: string, modelId?: string) => {
    const { setupContainer, container } = await import('../container.js');
    setupContainer();
    const catalog = container.resolve(ModelCatalog);

    if (action === 'list') {
      const models = await catalog.getAll();
      const discovered = await catalog.scanLocalModels(); // Get local models

      // Merge discovered models that aren't already in the catalog
      for (const d of discovered) {
        if (!(await catalog.get(d.id))) {
          models.push(d);
        }
      }

      if (models.length === 0) {
        console.log(chalk.dim('No models found.'));
        console.log(chalk.dim('  Run `adytum models scan` to find local models.'));
        console.log(chalk.dim('  Run `adytum models add <provider>/<model>` to add one manually.'));
        return;
      }

      console.log(chalk.bold('\nAvailable Models:\n'));

      // Group by provider
      const byProvider: Record<string, typeof models> = {};
      for (const m of models) {
        byProvider[m.provider] = byProvider[m.provider] || [];
        byProvider[m.provider].push(m);
      }

      for (const [provider, list] of Object.entries(byProvider)) {
        console.log(chalk.cyan(`  ${provider}`));
        for (const m of list) {
          const status =
            m.source === 'discovered'
              ? chalk.green('● (local)')
              : m.source === 'user'
                ? chalk.blue('● (configured)')
                : chalk.dim('● (system)');
          console.log(`    ${status} ${chalk.white(m.id)} ${chalk.dim(m.model)}`);
        }
        console.log();
      }
    } else if (action === 'scan') {
      console.log(chalk.dim('Scanning for local models...'));
      const discovered = await catalog.scanLocalModels();
      if (discovered.length === 0) {
        console.log(chalk.yellow('No local models found. Make sure Ollama/LM Studio is running.'));
      } else {
        console.log(chalk.green(`Found ${discovered.length} models:`));
        for (const d of discovered) {
          console.log(`  - ${d.id}`);
          // Auto-add? No, let user verify.
          // But ModelCatalog.scanLocalModels doesn't save.
          // We should probably offer to save them.
        }
        // For now, just listing them is fine. They appear in `list` anyway.
        console.log(chalk.dim('\nThese models are now available to use.'));
      }
    } else if (action === 'add') {
      if (!modelId) {
        console.error(
          chalk.red('Error: Model ID required. Usage: adytum models add <provider>/<model>'),
        );
        process.exit(1);
      }

      if (!modelId.includes('/')) {
        console.error(
          chalk.red(
            'Error: Model ID must be in format "provider/model" (e.g. anthropic/claude-3-opus)',
          ),
        );
        process.exit(1);
      }

      const [provider, modelName] = modelId.split('/');

      await catalog.add({
        id: modelId,
        name: modelId,
        provider,
        model: modelName,
        source: 'user',
        // We don't ask for API key here, user sets it in .env usually.
        // Or we could prompt? simpler to rely on .env for now.
      });
      console.log(chalk.green(`✓ Added model ${modelId}`));
    } else if (action === 'remove') {
      if (!modelId) {
        console.error(chalk.red('Error: Model ID required.'));
        process.exit(1);
      }
      await catalog.remove(modelId);
      console.log(chalk.green(`✓ Removed model ${modelId}`));
    } else {
      console.log(chalk.red(`Unknown action: ${action}`));
    }
  });

program.parse();

// Catch unhandled rejections so errors are never swallowed
process.on('unhandledRejection', (err: any) => {
  console.error(chalk.red(`\n  ❌ Unhandled error: ${err?.message || err}`));
  if (process.env.DEBUG) console.error(err);
  process.exit(1);
});
