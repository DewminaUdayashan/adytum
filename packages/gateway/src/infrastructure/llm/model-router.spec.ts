/**
 * @file packages/gateway/src/infrastructure/llm/model-router.spec.ts
 * @description Implements infrastructure adapters and external integrations.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ModelRouter } from './model-router.js';
import { LLMClient } from './llm-client.js';
import type { ModelRepository } from '../../domain/interfaces/model-repository.interface.js';
import type { ModelConfig } from '@adytum/shared';

vi.mock('./llm-client.js');

describe('ModelRouter', () => {
  let modelRouter: ModelRouter;
  let mockModelCatalog: ModelRepository;
  let mockLLMClient: any;

  const mockModels: ModelConfig[] = [
    { provider: 'anthropic', model: 'claude-3-sonnet', role: 'thinking', apiKey: 'key1' } as any,
    { provider: 'openai', model: 'gpt-4o', role: 'fast', apiKey: 'key2' } as any,
    { provider: 'openai', model: 'gpt-4o-mini', role: 'fast', apiKey: 'key3' } as any,
  ];

  const mockChains = {
    thinking: ['anthropic/claude-3-sonnet'],
    fast: ['openai/gpt-4o', 'openai/gpt-4o-mini'],
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockModelCatalog = {
      get: vi.fn().mockImplementation(async (id: string) => {
        const found = mockModels.find((m) => `${m.provider}/${m.model}` === id || m.model === id);
        return found ? { ...found } : null;
      }),
      list: vi.fn(),
      save: vi.fn(),
      delete: vi.fn(),
    } as any;

    mockLLMClient = {
      chat: vi.fn(),
    };
    (LLMClient as any).mockImplementation(() => mockLLMClient);

    modelRouter = new ModelRouter({
      litellmBaseUrl: 'http://localhost:4000',
      models: mockModels,
      modelChains: mockChains as any,
      taskOverrides: {},
      modelCatalog: mockModelCatalog,
      routing: {
        maxRetries: 2,
        fallbackOnRateLimit: true,
        fallbackOnError: false,
      },
    });
  });

  describe('chat', () => {
    it('should successfully call the first model in the chain', async () => {
      mockLLMClient.chat.mockResolvedValueOnce({
        message: { content: 'hello' },
        usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
      });

      const result = await modelRouter.chat('thinking', [{ role: 'user', content: 'hi' }]);

      expect(result.message.content).toBe('hello');
      expect(mockLLMClient.chat).toHaveBeenCalledTimes(1);
      expect(mockLLMClient.chat).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'claude-3-sonnet' }),
        expect.any(Object),
      );
    });

    it('should retry the same model on retriable error', async () => {
      mockLLMClient.chat.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce({
        message: { content: 'recovered' },
        usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
      });

      const result = await modelRouter.chat('thinking', [{ role: 'user', content: 'hi' }]);

      expect(result.message.content).toBe('recovered');
      expect(mockLLMClient.chat).toHaveBeenCalledTimes(2);
    });

    it('should fallback to next model on rate limit when fallbackOnRateLimit is true', async () => {
      modelRouter.updateRouting({
        maxRetries: 1,
        fallbackOnRateLimit: true,
        fallbackOnError: false,
      });

      mockLLMClient.chat.mockRejectedValueOnce(new Error('429 rate limit')).mockResolvedValueOnce({
        message: { content: 'fallback success' },
        usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
      });

      const result = await modelRouter.chat('fast', [{ role: 'user', content: 'hi' }]);

      expect(result.message.content).toBe('fallback success');
      expect(mockLLMClient.chat).toHaveBeenCalledTimes(2);
      expect(mockLLMClient.chat).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ model: 'gpt-4o' }),
        expect.any(Object),
      );
      expect(mockLLMClient.chat).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ model: 'gpt-4o-mini' }),
        expect.any(Object),
      );
    });

    it('should NOT fallback to next model on rate limit when fallbackOnRateLimit is false', async () => {
      modelRouter.updateRouting({
        maxRetries: 1,
        fallbackOnRateLimit: false,
        fallbackOnError: false,
      });

      mockLLMClient.chat.mockRejectedValue(new Error('429 rate limit'));

      await expect(modelRouter.chat('fast', [{ role: 'user', content: 'hi' }])).rejects.toThrow(
        /fallback is disabled/,
      );

      // Should try maxRetries (1) for the first model then stop
      expect(mockLLMClient.chat).toHaveBeenCalledTimes(1);
    });

    it('should fallback to next model on generic error when fallbackOnError is true', async () => {
      modelRouter.updateRouting({
        maxRetries: 1,
        fallbackOnRateLimit: true,
        fallbackOnError: true,
      });

      mockLLMClient.chat.mockRejectedValueOnce(new Error('generic failure')).mockResolvedValueOnce({
        message: { content: 'recovered' },
        usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
      });

      const result = await modelRouter.chat('fast', [{ role: 'user', content: 'hi' }]);

      expect(result.message.content).toBe('recovered');
      expect(mockLLMClient.chat).toHaveBeenCalledTimes(2);
    });
  });

  describe('chatStream', () => {
    it('should NOT fallback on error when fallbackOnError is false', async () => {
      modelRouter.updateRouting({
        maxRetries: 1,
        fallbackOnRateLimit: true,
        fallbackOnError: false,
      });

      mockLLMClient.chat.mockRejectedValueOnce(new Error('generic failure')).mockResolvedValueOnce({
        message: { content: 'unexpected fallback' },
        usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
      });

      const stream = modelRouter.chatStream('fast', [{ role: 'user', content: 'hi' }]);

      /**
       * Executes iterate stream.
       */
      const iterateStream = async () => {
        for await (const _ of stream) {
          // ...
        }
      };

      await expect(iterateStream()).rejects.toThrow(/fallback is disabled/);

      expect(mockLLMClient.chat).toHaveBeenCalledTimes(1);
    });
  });
});
