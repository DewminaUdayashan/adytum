/**
 * @file packages/gateway/src/domain/logic/compactor.ts
 * @description Advanced context compaction logic with boundary awareness and model-aware limits.
 */

import { singleton, inject } from 'tsyringe';
import type OpenAI from 'openai';
import { ModelRouter } from '../../infrastructure/llm/model-router.js';
import { Logger } from '../../logger.js';

const DEFAULT_BUFFER_MESSAGES = 8;
const WORD_TO_TOKEN_RATIO = 1.35; // Conservative estimate for GPT-style models

@singleton()
export class Compactor {
  constructor(
    @inject(ModelRouter) private modelRouter: ModelRouter,
    @inject(Logger) private logger: Logger,
  ) {}

  /**
   * Estimates tokens naively but conservatively based on word count.
   */
  public estimateTokens(content: string | any[] | null | undefined): number {
    if (!content) return 0;
    const text = typeof content === 'string' ? content : JSON.stringify(content);
    const words = text.trim().split(/\s+/).length;
    return Math.ceil(words * WORD_TO_TOKEN_RATIO) + 5; // +5 for message overhead
  }

  /**
   * Estimates tokens for a full message array.
   */
  public estimateContextTokens(messages: OpenAI.ChatCompletionMessageParam[]): number {
    return messages.reduce((acc, m) => acc + this.estimateTokens(m.content), 0);
  }

  /**
   * Finds a safe "cut point" in the message history.
   * Ensures we don't orphan a tool_call (i.e., we don't cut between a tool_call and its result).
   *
   * @param messages - Complete message history.
   * @param keepTrailing - Number of recent messages to keep intact.
   * @returns Index where the "old" messages end.
   */
  public findSafeCutPoint(
    messages: OpenAI.ChatCompletionMessageParam[],
    keepTrailing: number = DEFAULT_BUFFER_MESSAGES,
  ): number {
    // We want to keep at least 'keepTrailing' messages
    const minKeepIndex = Math.max(0, messages.length - keepTrailing);

    // Scan backward from the minKeepIndex to ensure we aren't mid-tool-sequence
    let cutPoint = minKeepIndex;

    while (cutPoint > 0) {
      const msg = messages[cutPoint];
      const prevMsg = messages[cutPoint - 1];

      // If the current message is a tool response, we definitely can't cut here
      // because we'd separate it from the assistant call that spawned it.
      if (msg.role === 'tool') {
        cutPoint--;
        continue;
      }

      // If the previous message had tool_calls, we can't cut after it
      // until we've seen all the tool results.
      if (prevMsg.role === 'assistant' && (prevMsg as any).tool_calls?.length > 0) {
        // Technically, if cutPoint is 'tool', we already retreated.
        // If cutPoint is 'assistant' (new turn), it's safe if it follows a tool result.
        // The safest rule: A cut is ONLY safe if the previous message was NOT an assistant tool call
        // and the current message is NOT a tool result.
        cutPoint--;
        continue;
      }

      break;
    }

    return cutPoint;
  }

  /**
   * Summarizes a massive chunk of text into a concise technical summary.
   */
  public async summarize(text: string, sessionId?: string): Promise<string> {
    const prompt = `Summarize the following technical content into a concise summary. 
Preserve all specific technical details, file paths, error codes, and key decisions.
Content length: ${text.length} characters.

Content:
${text.slice(0, 50000)} ${text.length > 50000 ? '... [TRUNCATED]' : ''}`;

    try {
      const { message } = await this.modelRouter.chat('fast', [{ role: 'user', content: prompt }], {
        temperature: 0.3,
      });

      return message.content || '[Summarization Failed]';
    } catch (e) {
      this.logger.error(`[Compactor] Summarization failed for session ${sessionId}`, e);
      return `[Automatic Truncation applied due to size limit. Original content length: ${text.length}]`;
    }
  }

  /**
   * Compacts a context by summarizing older messages.
   */
  public async compactContext(
    messages: OpenAI.ChatCompletionMessageParam[],
    sessionId?: string,
  ): Promise<OpenAI.ChatCompletionMessageParam[]> {
    const cutPoint = this.findSafeCutPoint(messages);
    if (cutPoint <= 1) return messages; // Nothing significant to compact

    const oldMessages = messages.slice(0, cutPoint);
    const recentMessages = messages.slice(cutPoint);

    const textToSummarize = oldMessages
      .map(
        (m) =>
          `${m.role.toUpperCase()}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`,
      )
      .join('\n---\n');

    const summary = await this.summarize(
      `Conversation history to be summarized:\n\n${textToSummarize}`,
      sessionId,
    );

    return [
      {
        role: 'system',
        content: `[Context Summary of earlier session]\n${summary}`,
      },
      ...recentMessages,
    ];
  }

  /**
   * Checks if a single message exceeds a safety threshold (e.g. 50% of context window).
   * If so, returns a summarized version.
   */
  public async guardLargeMessage(
    content: string,
    limit: number,
    sessionId?: string,
  ): Promise<string> {
    const estimatedTokens = this.estimateTokens(content);
    if (estimatedTokens < limit * 0.5) return content;

    this.logger.warn(
      `[Compactor] Message exceeds 50% of context window (${estimatedTokens} tokens). Summarizing...`,
    );

    return await this.summarize(content, sessionId);
  }
}
