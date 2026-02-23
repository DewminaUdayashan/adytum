/**
 * @file packages/gateway/src/domain/logic/runtime.integration.test.ts
 * @description Integration tests for AgentRuntime with mocks.
 */

import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentRuntime } from './agent-runtime.js';
import { ModelRouter } from '../../infrastructure/llm/model-router.js';
import { ToolRegistry } from '../../tools/registry.js';
import { SoulEngine } from './soul-engine.js';
import { SkillLoader } from '../../application/services/skill-loader.js';
import { ContextManager } from './context-manager.js';

// Mock dependencies
vi.mock('../../infrastructure/llm/model-router.js');
vi.mock('./soul-engine.js');
vi.mock('../../application/services/skill-loader.js');
vi.mock('../../tools/registry.js');

describe('AgentRuntime Integration', () => {
  let runtime: AgentRuntime;
  let mockModelRouter: any;
  let mockToolRegistry: any;
  let mockSoulEngine: any;
  let mockSkillLoader: any;
  let mockCompactor: any;
  let mockModelCatalog: any;
  let mockDispatchService: any;
  let mockRuntimeRegistry: any;
  let mockMessenger: any;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    mockModelRouter = new ModelRouter({} as any);
    mockToolRegistry = new ToolRegistry();

    mockSoulEngine = {
      getSoulPrompt: vi.fn(() => 'You are a helpful assistant.'),
      getArchitectPreamble: vi.fn(() => 'Architect preamble'),
      getManagerPreamble: vi.fn(() => 'Manager preamble'),
      reload: vi.fn(),
    };

    mockSkillLoader = {
      getSkillsContext: vi.fn().mockReturnValue(''),
      start: vi.fn().mockResolvedValue(undefined),
    };

    mockCompactor = {
      compactContext: vi.fn(),
      guardLargeMessage: vi.fn((m) => m),
      estimateTokens: vi.fn((m) => 10),
    };

    mockModelCatalog = {
      get: vi.fn().mockResolvedValue({ contextWindow: 32000 }),
    };

    mockDispatchService = {
      resolve: vi.fn().mockReturnValue(null),
    };

    mockRuntimeRegistry = {
      register: vi.fn(),
      unregister: vi.fn(),
    };

    mockMessenger = {
      getMessages: vi.fn().mockReturnValue([]),
    };

    // Setup basic mock responses
    mockToolRegistry.toOpenAITools.mockReturnValue([]);
    mockModelRouter.chat.mockResolvedValue({
      message: { role: 'assistant', content: 'Hello there!' },
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, estimatedCost: 0 },
    });

    runtime = new AgentRuntime({
      modelRouter: mockModelRouter,
      toolRegistry: mockToolRegistry,
      soulEngine: mockSoulEngine as any,
      skillLoader: mockSkillLoader as any,
      compactor: mockCompactor as any,
      modelCatalog: mockModelCatalog as any,
      dispatchService: mockDispatchService as any,
      runtimeRegistry: mockRuntimeRegistry as any,
      swarmManager: {
        updateActivity: vi.fn(),
      } as any,
      swarmMessenger: mockMessenger as any,
      graphContext: {} as any,
      workspacePath: '',
      contextSoftLimit: 1000,
      maxIterations: 5,
      defaultModelRole: 'thinking',
      agentName: 'TestAgent',
    });
  });

  it('should initialize and build system prompt', () => {
    // Run a turn to trigger context creation
    // (getOrCreateContext is usually called inside run)
    // Wait, getOrCreateContext is internal.

    // Check that soulEngine was used during some internal setup if any
    // or just run a turn.

    const context: ContextManager = (runtime as any).getOrCreateContext('bootstrap');
    expect(mockSoulEngine.getSoulPrompt).toHaveBeenCalled();
    const msgs = context.getMessages();
    expect(msgs[0].role).toBe('system');
    expect(msgs[0].content).toContain('You are a helpful assistant.');
  });

  it('should run a simple turn without tools', async () => {
    const result = await runtime.run('Hi', 'session-1');

    expect(result.response).toBe('Hello there!');
    expect(result.toolCalls).toHaveLength(0);
    expect(mockModelRouter.chat).toHaveBeenCalledTimes(1);
    // Check that user message was added
    expect(mockModelRouter.chat).toHaveBeenCalledWith(
      'thinking',
      expect.arrayContaining([expect.objectContaining({ role: 'user', content: 'Hi' })]),
      expect.anything(),
    );
  });

  it('should handle tool calls loop', async () => {
    // Mock first response to be a tool call
    mockModelRouter.chat
      .mockResolvedValueOnce({
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'test_tool', arguments: '{"arg":"val"}' },
            },
          ],
        },
        usage: { totalTokens: 10, estimatedCost: 0 },
      })
      .mockResolvedValueOnce({
        message: { role: 'assistant', content: 'Tool executed.' },
        usage: { totalTokens: 10, estimatedCost: 0 },
      });

    // Mock tool execution
    mockToolRegistry.execute.mockResolvedValue({ result: 'Success', isError: false });

    const result = await runtime.run('Do something', 'session-1');

    expect(result.response).toBe('Tool executed.');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('test_tool');

    // Verify flow:
    // 1. Model call (returns tool call)
    // 2. Tool execution
    // 3. Model call (with tool result)
    expect(mockModelRouter.chat).toHaveBeenCalledTimes(2);
    expect(mockToolRegistry.execute).toHaveBeenCalledTimes(1);
  });
});
