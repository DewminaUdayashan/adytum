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
   * Estimates the token count of the current context using a naive heuristic (4 chars ≈ 1 token).
   * Used for quick checks against the soft limit to avoid expensive tokenization calls.
   * @returns The estimated number of tokens.
   */
  estimateTokenCount(): number {
    const text = this.messages
      .map((m) => {
        if (typeof m.content === 'string') return m.content;
        return JSON.stringify(m.content);
      })
      .join(' ');
    // Include system prompt in estimation
    return Math.ceil((text.length + this.systemPrompt.length) / 4);
  }

  /**
   * Checks if the context size has exceeded the configured soft limit.
   * @returns True if compaction is needed, false otherwise.
   */
  needsCompaction(): boolean {
    return this.estimateTokenCount() > this.softLimit;
  }

  /**
   * Generates a prompt for the model to summarize the older part of the conversation.
   * Used when compaction is triggered.
   * @returns A string prompt instructing the model to summarize the conversation.
   */
  buildCompactionPrompt(): string {
    // Keep the last 6 messages intact to maintain recent context flow
    const oldMessages = this.messages.slice(0, -6);
    const text = oldMessages
      .map(
        (m) =>
          `${(m as any).role}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`,
      )
      .join('\n');

    return `Summarize the following conversation into a concise context summary that preserves all important technical details, decisions, file paths, error codes, and action items:\n\n${text}`;
  }

  /**
   * Applies the compaction result by replacing older messages with a summary system message.
   * Retains the most recent 6 messages.
   * @param summary - The generated summary of the older conversation.
   */
  applyCompaction(summary: string): void {
    const recentMessages = this.messages.slice(-6);
    this.messages = [
      {
        role: 'system',
        content: `[Context Summary from previous conversation]\n${summary}`,
      },
      ...recentMessages,
    ];
  }

  /**
   * Clears all conversation history (except the system prompt which is stored separately).
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
