/**
 * @file packages/gateway/src/domain/logic/context-manager.ts
 * @description Contains domain logic and core business behavior.
 */

import type OpenAI from 'openai';

/**
 * Manages the conversation context for an agent session.
 * Handles message history, system prompts, and token-aware context window management through summarization.
 */
export class ContextManager {
  private messages: OpenAI.ChatCompletionMessageParam[] = [];
  private systemPrompt: string = '';
  private softLimit: number;

  /**
   * Creates a new ContextManager instance.
   * @param softLimit - The soft limit for token count before compaction is triggered. Defaults to 40,000 tokens.
   */
  constructor(softLimit: number = 40000) {
    this.softLimit = softLimit;
  }

  /**
   * Sets the core system prompt (personality and instructions).
   * This prompt is always prepended to the message history during model calls.
   * @param prompt - The system prompt string.
   */
  setSystemPrompt(prompt: string): void {
    this.systemPrompt = prompt;
  }

  /**
   * Adds a message to the conversation history.
   * @param message - The message object to add (supporting OpenAI chat format).
   */
  addMessage(message: OpenAI.ChatCompletionMessageParam): void {
    this.messages.push(message);
  }

  /**
   * Retrieves the full array of messages including the system prompt.
   * Constructed dynamically on each call.
   * @returns An array of chat completion messages starting with the system prompt.
   */
  getMessages(): OpenAI.ChatCompletionMessageParam[] {
    return [{ role: 'system', content: this.systemPrompt }, ...this.messages];
  }

  /**
   * Estimates the token count of the current context.
   * Note: This is a placeholder for external estimation if needed,
   * but usually AgentRuntime will use the Compactor service.
   * @returns The estimated number of tokens (naive character-based).
   */
  estimateTokenCount(): number {
    const text = this.messages
      .map((m) => {
        if (typeof m.content === 'string') return m.content;
        return JSON.stringify(m.content);
      })
      .join(' ');
    return Math.ceil((text.length + this.systemPrompt.length) / 4);
  }

  /**
   * Checks if the context size has exceeded a limit.
   * @param limit - Optional limit override. Returns true if exceeded.
   */
  needsCompaction(limit?: number): boolean {
    const activeLimit = limit || this.softLimit;
    return this.estimateTokenCount() > activeLimit;
  }

  /**
   * Sets the message history directly. Used by Compactor.
   */
  setMessages(messages: OpenAI.ChatCompletionMessageParam[]): void {
    this.messages = messages;
  }

  /**
   * Clears all conversation history.
   */
  clear(): void {
    this.messages = [];
  }

  /**
   * Gets the number of messages currently in history (excluding the dynamic system prompt).
   * @returns The count of messages.
   */
  getMessageCount(): number {
    return this.messages.length;
  }
}
