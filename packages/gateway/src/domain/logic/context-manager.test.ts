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

  it('should not trigger compaction if small', () => {
    contextManager.addMessage({ role: 'user', content: 'short' });
    expect(contextManager.needsCompaction()).toBe(false);
  });

  it('should apply compaction correctly', () => {
    // Pre-populate with messages.
    // This part tests if messages are replaced by summary.
    contextManager.addMessage({ role: 'user', content: 'one' });
    contextManager.addMessage({ role: 'assistant', content: 'two' });
    contextManager.addMessage({ role: 'user', content: 'three' });
    contextManager.addMessage({ role: 'assistant', content: 'four' });
    contextManager.addMessage({ role: 'user', content: 'five' });
    contextManager.addMessage({ role: 'assistant', content: 'six' });
    contextManager.addMessage({ role: 'user', content: 'seven' }); // 7th msg (not including system)

    // applyCompaction logic: recentMessages = messages.slice(-6).
    // so if existing length is 7, it keeps last 6.
    // and adds summary message at index 0 (after system prompt in getMessages view).
    // Wait, messages array itself stores internal messages.
    // applyCompaction replaces this.messages with [system(summary), ...recent6].

    const summary = 'Summary of old conversation';
    contextManager.applyCompaction(summary);

    const msgs = contextManager.getMessages();
    // expected structure: [ {role:system, content: <original>}, {role:system, content: <summary>}, ...recent6 ]
    // Wait, getMessages() prepends system prompt from property.
    // applyCompaction pushes a system message with summary into messages array. This is strange (2 system messages?).
    // Yes, that's what the implementation does.

    expect(msgs.length).toBeGreaterThan(1);
    expect(msgs[1]!.content as string).toContain(summary);
  });
});
