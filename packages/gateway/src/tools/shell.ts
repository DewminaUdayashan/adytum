import { z } from 'zod';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { DANGEROUS_COMMANDS } from '@adytum/shared';
import type { ToolDefinition } from '@adytum/shared';

const execAsync = promisify(exec);

/**
 * Creates the shell_execute function body given an approval callback.
 * Exported so the REPL can re-wire the callback after tool registration.
 */
export function createShellToolWithApproval(
  onApprovalRequired: (command: string) => Promise<boolean>,
): ToolDefinition['execute'] {
  return async (args: any) => {
    const { command, cwd, timeout } = args as {
      command: string;
      cwd?: string;
      timeout: number;
    };

    // Check for dangerous commands
    const isDangerous = DANGEROUS_COMMANDS.some((pattern: string) =>
      command.toLowerCase().includes(pattern.toLowerCase()),
    );

    if (isDangerous) {
      const approved = await onApprovalRequired(command);
      if (!approved) {
        return {
          exitCode: -1,
          stdout: '',
          stderr: 'Command rejected by user: flagged as potentially dangerous.',
          approved: false,
        };
      }
    }

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd,
        timeout,
        maxBuffer: 1024 * 1024, // 1MB
        env: { ...process.env, PAGER: 'cat' },
      });

      return {
        exitCode: 0,
        stdout: stdout.slice(0, 10000), // Cap output
        stderr: stderr.slice(0, 5000),
        approved: isDangerous ? true : undefined,
      };
    } catch (error: any) {
      return {
        exitCode: error.code || 1,
        stdout: (error.stdout || '').slice(0, 10000),
        stderr: (error.stderr || error.message).slice(0, 5000),
      };
    }
  };
}

export function createShellTool(
  onApprovalRequired: (command: string) => Promise<boolean>,
): ToolDefinition {
  return {
    name: 'shell_execute',
    description: 'Execute a shell command on the host system. Dangerous commands require user approval.',
    requiresApproval: false,
    parameters: z.object({
      command: z.string().describe('The shell command to execute'),
      cwd: z.string().optional().describe('Working directory for the command'),
      timeout: z.number().default(30000).describe('Timeout in milliseconds'),
    }),
    execute: createShellToolWithApproval(onApprovalRequired),
  };
}
