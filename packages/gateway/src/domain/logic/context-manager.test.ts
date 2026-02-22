/**
 * @file packages/gateway/src/domain/logic/context-manager.test.ts
 * @description Contains domain logic and core business behavior.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ContextManager } from './context-manager.js';

describe('ContextManager', () => {
  let contextManager: ContextManager;

  beforeEach(() => {
    contextManager = new ContextManager(100);
  });

  it('should initialize with empty messages', () => {
    // The implementation initializes system prompt to '', so messages.length is fine.
    // However, getMessages() prepends system prompt.
    // So messages returned should include system prompt.
    const msgs = contextManager.getMessages();
    expect(msgs).toHaveLength(1); // just system prompt
    expect(msgs[0]).toEqual({ role: 'system', content: '' });
  });

  it('should add messages', () => {
    contextManager.addMessage({ role: 'user', content: 'hello' });
    const msgs = contextManager.getMessages();
    expect(msgs).toHaveLength(2);
    expect(msgs[1]).toEqual({ role: 'user', content: 'hello' });
  });

  it('should estimate token count correctly', () => {
    contextManager.setSystemPrompt('You are helpful.');
    contextManager.addMessage({ role: 'user', content: 'Hi' });
    // 'You are helpful.' (16) + 'Hi' (2) = 18 chars.
    // 18 / 4 = 4.5 -> ceil = 5.
    expect(contextManager.estimateTokenCount()).toBe(5);
  });

  it('should trigger compaction when limit exceeded', () => {
    // limit = 100.
    // Let's add enough text to exceed 400 chars (100 tokens * 4 chars).
    const longText = 'a'.repeat(401);
    contextManager.addMessage({ role: 'user', content: longText });
    expect(contextManager.needsCompaction()).toBe(true);
  });

  it('should support dynamic limits in needsCompaction', () => {
    contextManager.addMessage({ role: 'user', content: 'a'.repeat(200) }); // ~50 tokens
    expect(contextManager.needsCompaction(10)).toBe(true);
    expect(contextManager.needsCompaction(100)).toBe(false);
  });

  it('should allow setting messages directly', () => {
    contextManager.setMessages([{ role: 'system', content: 'summarized' }]);
    expect(contextManager.getMessages()).toHaveLength(2); // original system + new system
    expect(contextManager.getMessages()[1].content).toBe('summarized');
  });
});
