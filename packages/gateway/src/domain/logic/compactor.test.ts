/**
 * @file packages/gateway/src/domain/logic/compactor.test.ts
 * @description Unit tests for the Compactor service.
 */

import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Compactor } from './compactor.js';
import { ModelRouter } from '../../infrastructure/llm/model-router.js';
import { Logger } from '../../logger.js';
import type OpenAI from 'openai';

describe('Compactor', () => {
  let compactor: Compactor;
  let mockModelRouter: any;
  let mockLogger: any;

  beforeEach(() => {
    mockModelRouter = {
      chat: vi.fn(),
    };
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    compactor = new Compactor(mockModelRouter as any, mockLogger as any);
  });

  describe('estimateTokens', () => {
    it('should estimate tokens based on word count', () => {
      const text = 'Hello world from Adytum'; // 4 words
      // 4 * 1.35 = 5.4 -> ceil = 6 + 5 = 11
      expect(compactor.estimateTokens(text)).toBe(11);
    });

    it('should return 0 for empty content', () => {
      expect(compactor.estimateTokens(null)).toBe(0);
      expect(compactor.estimateTokens('')).toBe(0);
    });
  });

  describe('findSafeCutPoint', () => {
    it("should find a safe cut point that doesn't orphan tool calls", () => {
      const messages: OpenAI.ChatCompletionMessageParam[] = [
        { role: 'user', content: 'msg 1' },
        {
          role: 'assistant',
          content: 'msg 2',
          tool_calls: [{ id: '1', type: 'function', function: { name: 't1', arguments: '{}' } }],
        },
        { role: 'tool', tool_call_id: '1', content: 'result 1' },
        { role: 'assistant', content: 'msg 3' },
        { role: 'user', content: 'msg 4' },
        { role: 'user', content: 'msg 5' },
        { role: 'user', content: 'msg 6' },
        { role: 'user', content: 'msg 7' },
        { role: 'user', content: 'msg 8' },
        { role: 'user', content: 'msg 9' },
        { role: 'user', content: 'msg 10' },
      ];

      // Default buffer is 8. messages.length = 11.
      // minKeepIndex = 11 - 8 = 3.
      // messages[3] is 'assistant' (msg 3).
      // Check messages[3] (assistant) and prev messages[2] (tool).
      // It's safe to cut at index 3 because it's a new assistant turn after a tool result.

      const cutPoint = compactor.findSafeCutPoint(messages, 8);
      expect(cutPoint).toBe(3);
    });

    it('should retreat if mid-tool-sequence', () => {
      const messages: OpenAI.ChatCompletionMessageParam[] = [
        { role: 'user', content: 'msg 1' },
        {
          role: 'assistant',
          content: 'msg 2',
          tool_calls: [{ id: '1', type: 'function', function: { name: 't1', arguments: '{}' } }],
        },
        { role: 'tool', tool_call_id: '1', content: 'result 1' },
        { role: 'user', content: 'msg 4' },
        { role: 'user', content: 'msg 5' },
        { role: 'user', content: 'msg 6' },
      ];

      // messages.length = 6. keepTrailing = 4.
      // minKeepIndex = 6 - 4 = 2.
      // messages[2] is 'tool'. CUT AT 2 IS UNSAFE.
      // Retreals to 1.
      // messages[1] is 'assistant' with tool_calls. CUT AFTER 1 IS UNSAFE (separates tool_call from tool_result).
      // Retreals to 0. Safe.

      const cutPoint = compactor.findSafeCutPoint(messages, 4);
      expect(cutPoint).toBe(1); // Wait, if cutPoint is 1, it keeps messages from index 1.
      // messages.slice(0, 1) is index 0.
      // messages.slice(1) is index 1..5.
      // Index 1 is the assistant call. Index 2 is the tool result. They stay together.
      expect(cutPoint).toBe(1);
    });
  });

  describe('summarize', () => {
    it('should call modelRouter to summarize text', async () => {
      mockModelRouter.chat.mockResolvedValue({
        message: { content: 'This is a summary.' },
        usage: {},
      });

      const summary = await compactor.summarize('Very long text...');
      expect(summary).toBe('This is a summary.');
      expect(mockModelRouter.chat).toHaveBeenCalledWith(
        'fast',
        expect.any(Array),
        expect.any(Object),
      );
    });
  });

  describe('guardLargeMessage', () => {
    it('should summarize if message is over 50% limit', async () => {
      mockModelRouter.chat.mockResolvedValue({
        message: { content: 'Summary' },
        usage: {},
      });

      const longText = 'word '.repeat(1000); // ~1350 tokens
      const result = await compactor.guardLargeMessage(longText, 2000);

      expect(result).toBe('Summary');
      expect(mockModelRouter.chat).toHaveBeenCalled();
    });

    it('should return original text if within limits', async () => {
      const shortText = 'hello world';
      const result = await compactor.guardLargeMessage(shortText, 10000);

      expect(result).toBe(shortText);
      expect(mockModelRouter.chat).not.toHaveBeenCalled();
    });
  });
});
