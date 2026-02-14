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

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    mockModelRouter = new ModelRouter({} as any);
    mockToolRegistry = new ToolRegistry();
    mockSoulEngine = new SoulEngine('');
    mockSkillLoader = new SkillLoader('', {} as any);

    // Setup basic mock responses
    mockSoulEngine.getSoulPrompt.mockReturnValue('You are a helpful assistant.');
    mockSkillLoader.getSkillsContext.mockReturnValue('');
    mockToolRegistry.toOpenAITools.mockReturnValue([]);
    mockModelRouter.chat.mockResolvedValue({
      message: { role: 'assistant', content: 'Hello there!' },
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, estimatedCost: 0 },
    });

    runtime = new AgentRuntime({
      modelRouter: mockModelRouter,
      toolRegistry: mockToolRegistry,
      soulEngine: mockSoulEngine,
      skillLoader: mockSkillLoader,
      contextSoftLimit: 1000,
      maxIterations: 5,
      defaultModelRole: 'thinking',
      agentName: 'TestAgent',
    });
  });

  it('should initialize and build system prompt', () => {
    expect(mockSoulEngine.getSoulPrompt).toHaveBeenCalled();
    // Accessing private context to check if prompt is set (via casting to any for testing)
    const context: ContextManager = (runtime as any).context;
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
