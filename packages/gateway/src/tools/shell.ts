import { z } from 'zod';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { DANGEROUS_COMMANDS } from '@adytum/shared';
import type { ToolDefinition } from '@adytum/shared';

const execAsync = promisify(exec);

export type ShellApprovalResult = {
  approved: boolean;
  reason?: string;
  mode?: 'auto' | 'ask' | 'deny';
  defaultChannel?: string;
  message?: string;
};

export type ShellApprovalFn = (command: string) => Promise<ShellApprovalResult>;

/**
 * Creates the shell_execute function body given an approval callback.
 * Exported so the REPL can re-wire the callback after tool registration.
 */
export function createShellToolWithApproval(
  onApprovalRequired: ShellApprovalFn,
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

    const approval = isDangerous ? await onApprovalRequired(command) : { approved: true };
    if (!approval.approved) {
      return {
        exitCode: -1,
        stdout: '',
        stderr: approval.message || 'Command rejected: approval required.',
        approved: false,
        approvalRequired: true,
        defaultChannel: approval.defaultChannel,
        reason: approval.reason,
        mode: approval.mode,
      };
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
        approved: approval.approved,
        mode: approval.mode,
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
  onApprovalRequired: ShellApprovalFn,
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
