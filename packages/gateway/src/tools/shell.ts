/**
 * @file packages/gateway/src/tools/shell.ts
 * @description Defines tool handlers exposed to the runtime.
 */

import { z } from 'zod';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { DANGEROUS_COMMANDS, type ToolDefinition } from '@adytum/shared';

const execAsync = promisify(exec);

export type ShellApprovalResult = {
  approved: boolean;
  reason?: string;
  mode?: 'auto' | 'ask' | 'deny';
  defaultChannel?: string;
  defaultCommSkillId?: string;
  message?: string;
};

export type ShellApprovalFn = (
  command: string,
  context?: { sessionId: string; workspaceId?: string },
) => Promise<ShellApprovalResult>;

/**
 * Creates the shell_execute function body given an approval callback.
 * Exported so the REPL can re-wire the callback after tool registration.
 */
export function createShellToolWithApproval(
  onApprovalRequired: ShellApprovalFn,
  resolveWorkspacePath?: (workspaceId: string) => string,
): ToolDefinition['execute'] {
  return async (args: any) => {
    const { command, cwd, timeout, sessionId, workspaceId } = args as {
      command: string;
      cwd?: string;
      timeout: number;
      sessionId: string;
      workspaceId?: string;
    };

    // Resolve base CWD if workspaceId is present and no explicit absolute CWD is provided
    let effectiveCwd = cwd;
    if (workspaceId && resolveWorkspacePath) {
      const wsPath = resolveWorkspacePath(workspaceId);
      if (wsPath) {
        if (!effectiveCwd || !effectiveCwd.startsWith('/')) {
          effectiveCwd = effectiveCwd ? join(wsPath, effectiveCwd) : wsPath;
        }
      }
    }

    // Always consult approval policy (policy decides auto/ask/deny)
    // Heuristic: Check for critical files in command
    const criticalFiles = ['adytum.config.yaml', '.env', 'security.json', 'litellm_config.yaml'];
    const isCritical = criticalFiles.some((file) => command.includes(file));

    // If critical file detected, force ASK mode and append warning
    // This is a basic string check, but better than nothing
    let wrappedApprovalFn = onApprovalRequired;
    if (isCritical) {
      wrappedApprovalFn = async (cmd: string) => {
        const result = await onApprovalRequired(cmd);
        if (result.mode === 'auto') {
          // Downgrade AUTO to ASK for critical files
          result.mode = 'ask';
          result.message =
            (result.message || '') +
            '\n⚠️  CRITICAL FILE DETECTED: This command targets sensitive configuration files.';
        }
        return result;
      };
    }

    const approval = await wrappedApprovalFn(command, { sessionId, workspaceId });
    if (!approval.approved) {
      return {
        exitCode: -1,
        stdout: '',
        stderr:
          approval.message || 'Command cancelled by user request. You may try again if necessary.',
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
        cwd: effectiveCwd,
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

/**
 * Creates shell tool.
 * @param onApprovalRequired - On approval required.
 * @returns The create shell tool result.
 */
export function createShellTool(
  onApprovalRequired: ShellApprovalFn,
  resolveWorkspacePath?: (workspaceId: string) => string,
): ToolDefinition {
  return {
    name: 'shell_execute',
    description:
      'Execute a shell command. Permissions: You are AUTHORIZED to use this tool. If a command requires approval, the system will ask the user. Do NOT refuse to run commands because you think you lack permission. DYNAMIC DATA: Always run this tool to get fresh output. Do NOT rely on memory or previous conversation history for command outputs, as they may be stale.',
    requiresApproval: false,
    parameters: z.object({
      command: z.string().describe('The shell command to execute'),
      cwd: z.string().optional().describe('Working directory for the command'),
      timeout: z.number().default(30000).describe('Timeout in milliseconds'),
      sessionId: z.string().describe('Internal session ID for approval routing'),
      workspaceId: z.string().optional().describe('Internal workspace ID for approval routing'),
    }),
    execute: createShellToolWithApproval(onApprovalRequired, resolveWorkspacePath),
  };
}
