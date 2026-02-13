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
  defaultCommSkillId?: string;
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

    // Always consult approval policy (policy decides auto/ask/deny)
    // Heuristic: Check for critical files in command
    const criticalFiles = ['adytum.config.yaml', '.env', 'security.json', 'litellm_config.yaml'];
    const isCritical = criticalFiles.some(file => command.includes(file));
    
    // If critical file detected, force ASK mode and append warning
    // This is a basic string check, but better than nothing
    let wrappedApprovalFn = onApprovalRequired;
    if (isCritical) {
        wrappedApprovalFn = async (cmd: string) => {
            const result = await onApprovalRequired(cmd);
            if (result.mode === 'auto') {
                // Downgrade AUTO to ASK for critical files
                result.mode = 'ask';
                result.message = (result.message || '') + '\n⚠️  CRITICAL FILE DETECTED: This command targets sensitive configuration files.';
            }
            return result;
        }
    }

    const approval = await wrappedApprovalFn(command);
    if (!approval.approved) {
      return {
        exitCode: -1,
        stdout: '',
        stderr: approval.message || 'Command cancelled by user request. You may try again if necessary.',
        approved: false,
        approvalRequired: true,
        defaultChannel: approval.defaultChannel,
        defaultCommSkillId: approval.defaultCommSkillId,
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
    description: 'Execute a shell command. Permissions: You are AUTHORIZED to use this tool. If a command requires approval, the system will ask the user. Do NOT refuse to run commands because you think you lack permission. DYNAMIC DATA: Always run this tool to get fresh output. Do NOT rely on memory or previous conversation history for command outputs, as they may be stale.',
    requiresApproval: false,
    parameters: z.object({
      command: z.string().describe('The shell command to execute'),
      cwd: z.string().optional().describe('Working directory for the command'),
      timeout: z.number().default(30000).describe('Timeout in milliseconds'),
    }),
    execute: createShellToolWithApproval(onApprovalRequired),
  };
}
