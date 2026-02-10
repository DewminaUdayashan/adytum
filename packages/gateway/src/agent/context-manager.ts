import type OpenAI from 'openai';

/**
 * Context Manager — manages conversation history with token-aware compaction.
 */
export class ContextManager {
  private messages: OpenAI.ChatCompletionMessageParam[] = [];
  private systemPrompt: string = '';
  private softLimit: number;

  constructor(softLimit: number = 40000) {
    this.softLimit = softLimit;
  }

  setSystemPrompt(prompt: string): void {
    this.systemPrompt = prompt;
  }

  addMessage(message: OpenAI.ChatCompletionMessageParam): void {
    this.messages.push(message);
  }

  /** Get the full message array for the model call. */
  getMessages(): OpenAI.ChatCompletionMessageParam[] {
    return [
      { role: 'system', content: this.systemPrompt },
      ...this.messages,
    ];
  }

  /** Rough token estimation (4 chars ≈ 1 token). */
  estimateTokenCount(): number {
    const text = this.messages
      .map((m) => {
        if (typeof m.content === 'string') return m.content;
        return JSON.stringify(m.content);
      })
      .join(' ');
    return Math.ceil((text.length + this.systemPrompt.length) / 4);
  }

  /** Check if we're over the soft limit and need compaction. */
  needsCompaction(): boolean {
    return this.estimateTokenCount() > this.softLimit;
  }

  /**
   * Compact the conversation by summarizing older messages.
   * Returns a summary prompt for the model to generate.
   */
  buildCompactionPrompt(): string {
    const oldMessages = this.messages.slice(0, -6); // Keep last 6 messages
    const text = oldMessages
      .map((m) => `${(m as any).role}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`)
      .join('\n');

    return `Summarize the following conversation into a concise context summary that preserves all important technical details, decisions, file paths, error codes, and action items:\n\n${text}`;
  }

  /**
   * Apply compaction — replace old messages with a summary.
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

  /** Clear all messages. */
  clear(): void {
    this.messages = [];
  }

  /** Get message count. */
  getMessageCount(): number {
    return this.messages.length;
  }
}
