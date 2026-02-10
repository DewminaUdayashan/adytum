#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { ADYTUM_VERSION } from '@adytum/shared';
import { runBirthProtocol } from './birth-protocol.js';
import { existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { confirm } from '@inquirer/prompts';

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
        message: 'Adytum is already initialized in this directory. Do you want to reset all settings and start over?',
        default: false,
      });

      if (!reset) {
        console.log(chalk.dim('\n   Run `adytum start` to start the agent.'));
        return;
      }

      console.log(chalk.yellow('\n⚠  Starting over... Existing configuration will be overwritten.\n'));

      // Cleanup persist data
      try {
        const dataPath = join(projectRoot, 'data');
        if (existsSync(dataPath)) {
          rmSync(dataPath, { recursive: true, force: true });
          console.log(chalk.dim('   ✓ Cleared data/ directory (memory, logs, cron jobs)'));
        }
      } catch (e) {}
    }

    await runBirthProtocol(projectRoot);
  });

// ─── adytum start ─────────────────────────────────────────────
program
  .command('start')
  .description('Start the Adytum gateway and open terminal chat')
  .action(async () => {
    const projectRoot = process.cwd();

    if (!existsSync(join(projectRoot, 'adytum.config.yaml'))) {
      console.log(chalk.red('✗  No adytum.config.yaml found.'));
      console.log(chalk.dim('   Run `adytum init` first to set up your agent.\n'));
      process.exit(1);
    }

    try {
      // Dynamically import to avoid loading heavy deps during init
      const { startGateway } = await import('../index.js');
      await startGateway(projectRoot);
    } catch (err: any) {
      console.error(chalk.red(`\n  ❌ Gateway failed to start: ${err.message}`));
      if (process.env.DEBUG) console.error(err);
      process.exit(1);
    }
  });

// ─── adytum status ────────────────────────────────────────────
program
  .command('status')
  .description('Show gateway status, model config, and token usage')
  .action(async () => {
    try {
      const response = await fetch('http://localhost:3001/api/health');
      const data = await response.json() as any;
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

// ─── adytum skill install ─────────────────────────────────────
program
  .command('skill')
  .argument('<action>', 'install | list | remove')
  .argument('[url]', 'Git repository URL (for install)')
  .description('Manage agent skills')
  .action(async (action: string, url?: string) => {
    if (action === 'list') {
      const { SkillLoader } = await import('../agent/skill-loader.js');
      const loader = new SkillLoader(join(process.cwd(), 'workspace'));
      const skills = loader.getAll();

      if (skills.length === 0) {
        console.log(chalk.dim('No skills installed.'));
        console.log(chalk.dim('  Create a folder in workspace/skills/ with a SKILL.md'));
        return;
      }

      console.log(chalk.bold('Installed Skills:\n'));
      for (const skill of skills) {
        console.log(`  ${chalk.green('●')} ${chalk.white(skill.metadata.name)}`);
        console.log(`    ${chalk.dim(skill.metadata.description)}`);
      }
    } else if (action === 'install' && url) {
      console.log(chalk.yellow(`Installing skill from ${url}...`));
      // TODO: Git clone + validation in Phase 3
      console.log(chalk.dim('  Skill installation from Git will be available in Phase 3.'));
    } else {
      console.log(chalk.dim('Usage: adytum skill install <git-url>'));
      console.log(chalk.dim('       adytum skill list'));
    }
  });

program.parse();

// Catch unhandled rejections so errors are never swallowed
process.on('unhandledRejection', (err: any) => {
  console.error(chalk.red(`\n  ❌ Unhandled error: ${err?.message || err}`));
  if (process.env.DEBUG) console.error(err);
  process.exit(1);
});
