/**
 * @file packages/gateway/src/domain/logic/agent-runtime.autonomy.test.ts
 * @description Validates autonomy and completion guards in AgentRuntime.
 */

import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { AgentRuntime } from './agent-runtime.js';
import { ToolRegistry } from '../../tools/registry.js';

const baseUsage = {
  model: 'test/model',
  role: 'thinking' as const,
  promptTokens: 10,
  completionTokens: 10,
  totalTokens: 20,
  estimatedCost: 0,
};

function createRuntime(chatMock: any, toolRegistry: ToolRegistry): AgentRuntime {
  const modelRouter = { chat: chatMock } as any;
  const soulEngine = {
    getSoulPrompt: () => 'You are test runtime.',
    getArchitectPreamble: () => 'Architect preamble',
    getManagerPreamble: () => 'Manager preamble',
  } as any;
  const skillLoader = { getSkillsContext: () => '' } as any;
  const compactor = {
    guardLargeMessage: async (res: any) => res,
    applyCompaction: async (ctx: any) => ctx.getMessages(),
  } as any;
  const modelCatalog = { get: async () => ({ contextWindow: 32000 }) } as any;
  const dispatchService = { resolve: () => null } as any;
  const runtimeRegistry = { register: () => {}, unregister: () => {} } as any;
  const swarmManager = { updateActivity: () => {} } as any;
  const swarmMessenger = { getMessages: () => [] } as any;

  return new AgentRuntime({
    modelRouter,
    toolRegistry,
    soulEngine,
    skillLoader,
    compactor,
    modelCatalog,
    dispatchService,
    runtimeRegistry,
    swarmManager,
    swarmMessenger,
    contextSoftLimit: 10000,
    maxIterations: 10,
    defaultModelRole: 'thinking',
    agentName: 'TestAgent',
  });
}

describe('AgentRuntime autonomy guards', () => {
  it('continues execution when model asks avoidable coding clarification', async () => {
    const registry = new ToolRegistry();
    const writeExec = vi.fn().mockResolvedValue('wrote file');
    const listExec = vi.fn().mockResolvedValue({ entries: [] });
    registry.register({
      name: 'file_write',
      description: 'Write a file',
      parameters: z.object({
        path: z.string(),
        content: z.string(),
        sessionId: z.string().optional(),
        workspaceId: z.string().optional(),
      }),
      execute: writeExec,
    });
    registry.register({
      name: 'file_list',
      description: 'List files',
      parameters: z.object({
        path: z.string(),
        sessionId: z.string().optional(),
        workspaceId: z.string().optional(),
      }),
      execute: listExec,
    });

    const chatMock = vi
      .fn()
      .mockResolvedValueOnce({
        message: { role: 'assistant', content: 'Should I create this in the project directory?' },
        usage: baseUsage,
      })
      .mockResolvedValueOnce({
        message: {
          role: 'assistant',
          content:
            'I see a packages directory in your workspace. Could you please tell me which package is related to the Google Places API? I need to know where to create the new screen and its logic.',
        },
        usage: baseUsage,
      })
      .mockResolvedValueOnce({
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: {
                name: 'file_write',
                arguments: JSON.stringify({
                  path: 'src/settings.tsx',
                  content: 'export const Settings = () => null;',
                }),
              },
            },
            {
              id: 'call_2',
              type: 'function',
              function: {
                name: 'file_list',
                arguments: JSON.stringify({
                  path: '.',
                }),
              },
            },
          ],
        },
        usage: baseUsage,
      })
      .mockResolvedValueOnce({
        message: { role: 'assistant', content: 'Done. Implemented and integrated end-to-end.' },
        usage: baseUsage,
      });

    const runtime = createRuntime(chatMock, registry);
    const result = await runtime.run(
      'Create a new settings screen and wire it into router navigation.',
      'session-autonomy-1',
    );

    expect(result.response).toContain('Implemented and integrated');
    expect(chatMock).toHaveBeenCalledTimes(4);
    expect(writeExec).toHaveBeenCalledTimes(1);
    expect(listExec).toHaveBeenCalledTimes(1);
  });

  it('requests a completion pass after writes before finalizing', async () => {
    const registry = new ToolRegistry();
    const writeExec = vi.fn().mockResolvedValue('wrote file');
    const listExec = vi.fn().mockResolvedValue({ entries: [] });

    registry.register({
      name: 'file_write',
      description: 'Write a file',
      parameters: z.object({
        path: z.string(),
        content: z.string(),
        sessionId: z.string().optional(),
        workspaceId: z.string().optional(),
      }),
      execute: writeExec,
    });

    registry.register({
      name: 'file_list',
      description: 'List files',
      parameters: z.object({
        path: z.string(),
        sessionId: z.string().optional(),
        workspaceId: z.string().optional(),
      }),
      execute: listExec,
    });

    const chatMock = vi
      .fn()
      .mockResolvedValueOnce({
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: {
                name: 'file_write',
                arguments: JSON.stringify({
                  path: 'src/new-feature.tsx',
                  content: 'export const NewFeature = () => null;',
                }),
              },
            },
          ],
        },
        usage: baseUsage,
      })
      .mockResolvedValueOnce({
        message: { role: 'assistant', content: 'I created the feature screen.' },
        usage: baseUsage,
      })
      .mockResolvedValueOnce({
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_2',
              type: 'function',
              function: {
                name: 'file_list',
                arguments: JSON.stringify({ path: '.' }),
              },
            },
          ],
        },
        usage: baseUsage,
      })
      .mockResolvedValueOnce({
        message: {
          role: 'assistant',
          content: 'Done. Integrated routes/navigation and verified the update.',
        },
        usage: baseUsage,
      });

    const runtime = createRuntime(chatMock, registry);
    const result = await runtime.run(
      'Build a new feature page and connect it fully in the app.',
      'session-autonomy-2',
    );

    expect(result.response).toContain('Integrated routes/navigation');
    expect(chatMock).toHaveBeenCalledTimes(4);
    expect(writeExec).toHaveBeenCalledTimes(1);
    expect(listExec).toHaveBeenCalledTimes(1);
  });
});
