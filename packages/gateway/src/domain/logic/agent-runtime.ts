/**
 * @file packages/gateway/src/domain/logic/agent-runtime.ts
 * @description Contains domain logic and core business behavior.
 */

import { v4 as uuid } from 'uuid';
import type OpenAI from 'openai';
import type { ModelRole, ToolCall, Trace } from '@adytum/shared';
import { ContextManager } from './context-manager.js';
import { ModelRouter } from '../../infrastructure/llm/model-router.js';
import { SoulEngine } from './soul-engine.js';
import { SkillLoader } from '../../application/services/skill-loader.js';
import { ToolRegistry } from '../../tools/registry.js';
import { tokenTracker } from './token-tracker.js';
import { auditLogger } from '../../security/audit-logger.js';
import { EventEmitter } from 'node:events';
import type { MemoryStore } from '../../infrastructure/repositories/memory-store.js';
import type { MemoryDB } from '../../infrastructure/repositories/memory-db.js';

export interface AgentRuntimeConfig {
  modelRouter: ModelRouter;
  toolRegistry: ToolRegistry;
  soulEngine: SoulEngine;
  skillLoader: SkillLoader;
  contextSoftLimit: number;
  maxIterations: number;
  defaultModelRole: ModelRole;
  agentName: string;
  workspacePath?: string;
  memoryStore?: MemoryStore;
  memoryTopK?: number;
  memoryDb?: MemoryDB;
  onApprovalRequired?: (description: string) => Promise<boolean>;
}

export interface AgentTurnResult {
  response: string;
  trace: Trace;
  toolCalls: ToolCall[];
}

/**
 * The core ReAct Agent Runtime that orchestrates the agent's thought process.
 *
 * It manages the main execution loop:
 * 1. Building context (System prompt + Message History + Relevant Memories)
 * 2. Calling the LLM via the ModelRouter
 * 3. Handling tool calls and executing them via ToolRegistry
 * 4. Looping back with tool results until a final answer is reached
 *
 * It also handles token tracking, audit logging, and security approvals.
 */
export class AgentRuntime extends EventEmitter {
  private config: AgentRuntimeConfig;
  private context: ContextManager;
  private systemPromptText: string = '';

  /**
   * Creates a new AgentRuntime instance.
   * @param config - Configuration object containing dependencies and settings.
   */
  constructor(config: AgentRuntimeConfig) {
    super();
    this.config = config;
    this.context = new ContextManager(config.contextSoftLimit);
    this.buildSystemPrompt();
  }

  /**
   * Sets a custom handler for approval requests (e.g., from tools like shell_execute).
   * @param handler - A function that returns a Promise<boolean> indicating approval.
   */
  setApprovalHandler(handler: (description: string) => Promise<boolean>): void {
    this.config.onApprovalRequired = handler;
  }

  /**
   * Seeds the agent's context with a history of messages.
   * Useful for restoring state after a restart.
   * @param messages - Array of role/content pairs to add to history.
   */
  seedContext(
    messages: Array<{ role: OpenAI.ChatCompletionMessageParam['role']; content: string }>,
  ): void {
    for (const m of messages) {
      this.context.addMessage({
        role: m.role,
        content: m.content,
      } as OpenAI.ChatCompletionMessageParam);
    }
  }

  /**
   * Executes a full agent turn based on a user message.
   * This involves the ReAct loop: Think -> Act -> Observe -> Repeat.
   *
   * @param userMessage - The input message from the user.
   * @param sessionId - Unique identifier for the current session.
   * @param overrides - Optional overrides for model selection.
   * @returns A Promise resolving to the result of the turn (response, trace, tool calls).
   */
  async run(
    userMessage: string,
    sessionId: string,
    overrides?: { modelRole?: string; modelId?: string },
  ): Promise<AgentTurnResult> {
    const isBackgroundSession = this.isBackgroundSession(sessionId);
    if (!isBackgroundSession && this.hasHeartbeatPromptLeakage()) {
      this.context.clear();
      this.context.setSystemPrompt(this.systemPromptText);
      this.emit('stream', {
        traceId: uuid(),
        sessionId,
        streamType: 'status',
        delta: 'Recovered from background-task prompt leakage by resetting volatile context.',
      });
    }
    const context = isBackgroundSession ? this.createIsolatedContext() : this.context;

    const traceId = uuid();
    const trace: Trace = {
      id: traceId,
      sessionId,
      startTime: Date.now(),
      initialGoal: userMessage,
      status: 'running',
    };

    this.emit('trace_start', trace);

    // Add user message to context
    context.addMessage({ role: 'user', content: userMessage });
    if (this.config.memoryDb && !isBackgroundSession) {
      this.config.memoryDb.addMessage(sessionId, 'user', userMessage);
    }

    // Auto-extract simple user memory facts (e.g., nickname) and store persistently
    const extracted = this.extractUserMemory(userMessage);
    if (extracted && this.config.memoryStore) {
      this.config.memoryStore.add(extracted, 'user', ['auto'], undefined, 'user_fact');
    }

    // Prepare memory context for this turn
    const memoryContext = this.buildMemoryContext(userMessage);

    const allToolCalls: ToolCall[] = [];
    let finalResponse = '';
    let iterations = 0;
    let lastMessage: any = null;

    try {
      while (iterations < this.config.maxIterations) {
        iterations++;

        // Check for compaction
        if (context.needsCompaction()) {
          await this.compactContext(context, traceId, sessionId);
        }

        const roleToUse = overrides?.modelRole || this.config.defaultModelRole;

        // Call the model
        auditLogger.logModelCall(traceId, roleToUse, this.context.getMessageCount());
        if (this.config.memoryDb) {
          this.config.memoryDb.addActionLog(
            traceId,
            'model_call',
            {
              role: roleToUse,
              messageCount: context.getMessageCount(),
            },
            'success',
          );
        }

        this.emit('stream', {
          traceId,
          sessionId,
          streamType: 'status',
          delta: `Thinking... (iteration ${iterations})`,
        });

        const baseMessages = context.getMessages();
        const modelMessages = memoryContext
          ? [
              baseMessages[0],
              { role: 'system', content: memoryContext } as OpenAI.ChatCompletionMessageParam,
              ...baseMessages.slice(1),
            ]
          : baseMessages;

        const { message, usage } = await this.config.modelRouter.chat(
          overrides?.modelId || roleToUse,
          modelMessages,
          {
            tools: this.config.toolRegistry.toOpenAITools(),
            temperature: 0.7,
            fallbackRole: roleToUse as any,
          },
        );
        lastMessage = message;

        // Track tokens
        this.trackTokenUsage(usage, sessionId);
        auditLogger.logModelResponse(traceId, usage.model, usage);
        if (this.config.memoryDb) {
          this.config.memoryDb.addActionLog(
            traceId,
            'model_response',
            {
              model: usage.model,
              promptTokens: usage.promptTokens,
              completionTokens: usage.completionTokens,
              totalTokens: usage.totalTokens,
              cost: usage.estimatedCost,
            },
            'success',
          );
        }

        // Check for tool calls
        if (message.tool_calls && message.tool_calls.length > 0) {
          // Add assistant message with tool calls to context
          // Ensure content is never null (some providers like Google Gemini reject it)
          const sanitizedMessage = {
            ...message,
            content: message.content || '',
          };
          context.addMessage(sanitizedMessage as OpenAI.ChatCompletionMessageParam);

          // Execute each tool call
          for (const tc of message.tool_calls) {
            const toolCall: ToolCall = {
              id: tc.id,
              name: tc.function.name,
              arguments: JSON.parse(tc.function.arguments),
            };

            allToolCalls.push(toolCall);

            // Emit tool call event for live console
            this.emit('stream', {
              traceId,
              sessionId,
              streamType: 'tool_call',
              delta: `Calling tool: ${toolCall.name}`,
              metadata: { tool: toolCall.name, args: toolCall.arguments },
            });

            auditLogger.logToolCall(traceId, toolCall.name, toolCall.arguments);
            if (this.config.memoryDb) {
              this.config.memoryDb.addActionLog(
                traceId,
                'tool_call',
                {
                  tool: toolCall.name,
                  arguments: toolCall.arguments,
                },
                'success',
              );
            }

            // Check if tool requires approval
            const toolDef = this.config.toolRegistry.get(toolCall.name);
            if (toolDef?.requiresApproval && this.config.onApprovalRequired) {
              const approved = await this.config.onApprovalRequired(
                `Tool "${toolCall.name}" wants to execute: ${JSON.stringify(toolCall.arguments)}`,
              );
              if (!approved) {
                context.addMessage({
                  role: 'tool',
                  tool_call_id: tc.id,
                  content: 'Action rejected by user.',
                });
                continue;
              }
            }

            // Execute the tool
            const result = await this.config.toolRegistry.execute(toolCall);

            auditLogger.logToolResult(traceId, toolCall.name, result.result, result.isError);
            if (this.config.memoryDb) {
              this.config.memoryDb.addActionLog(
                traceId,
                'tool_result',
                {
                  tool: toolCall.name,
                  result: result.result,
                  isError: result.isError,
                },
                result.isError ? 'error' : 'success',
              );
            }

            this.emit('stream', {
              traceId,
              sessionId,
              streamType: 'tool_result',
              delta: `Tool ${toolCall.name}: ${result.isError ? 'ERROR' : 'OK'}`,
              metadata: { result: result.result },
            });

            // Add tool result to context
            context.addMessage({
              role: 'tool',
              tool_call_id: tc.id,
              content:
                typeof result.result === 'string' ? result.result : JSON.stringify(result.result),
            });
          }

          // Continue the loop — model will process tool results
          continue;
        }

        // No tool calls — this is the final response
        finalResponse = message.content || '';

        // Stream the response
        if (message.content) {
          auditLogger.logThinking(traceId, message.content);
          this.emit('stream', {
            traceId,
            sessionId,
            streamType: 'response',
            delta: message.content,
          });
        }

        // Add assistant response to context
        context.addMessage({ role: 'assistant', content: finalResponse });
        if (this.config.memoryDb && !isBackgroundSession) {
          this.config.memoryDb.addMessage(sessionId, 'assistant', finalResponse);
          this.config.memoryDb.addActionLog(
            traceId,
            'message_sent',
            {
              content: finalResponse,
            },
            'success',
          );
        }
        break;
      }

      if (!finalResponse.trim()) {
        const rawMsg = JSON.stringify(lastMessage || {}, null, 2);
        console.warn('⚠️ Warning: Received empty response from model.');
        console.warn('Raw message received:', rawMsg);

        // Check for refusal (OpenAI/Gemini safety)
        if ((lastMessage as any)?.refusal) {
          finalResponse = `Model refused to answer: ${(lastMessage as any).refusal}`;
        }
        // Check for thinking content (DeepSeek/Reasoning models)
        else if ((lastMessage as any)?.reasoning_content) {
          finalResponse = (lastMessage as any).reasoning_content;
        }
        // If model returned text content but we never surfaced it
        else if (
          typeof (lastMessage as any)?.content === 'string' &&
          (lastMessage as any).content.trim()
        ) {
          finalResponse = (lastMessage as any).content.trim();
        } else {
          finalResponse =
            'I did not receive a usable response from the model. Please check the terminal logs for details.';
        }
      }

      trace.endTime = Date.now();
      trace.outcome = finalResponse.slice(0, 200);
      trace.status = 'completed';
    } catch (error: any) {
      trace.endTime = Date.now();
      trace.status = 'failed';
      trace.outcome = error.message;

      // Provide a user-friendly error instead of raw stack trace
      const msg = error.message || String(error);
      if (msg.includes('All models failed')) {
        finalResponse = `I encountered an error: ${msg}`;
      } else if (msg.includes('No API key')) {
        finalResponse = `I can't respond because: ${msg}`;
      } else if (msg.includes('ECONNREFUSED') || msg.includes('fetch failed')) {
        finalResponse = `I can't reach the model provider. Check your API keys or network connection.\n\nDetails: ${msg}`;
      } else {
        finalResponse = `I encountered an error: ${msg}`;
      }

      // Do NOT add ephemeral errors to context or memory history.
      // This prevents the agent from "hallucinating" that it is still broken in future turns.
      // We only return the error to the user via the response.

      if (this.config.memoryDb) {
        this.config.memoryDb.addActionLog(traceId, 'error', { message: finalResponse }, 'error');
      }
    }

    this.emit('trace_end', trace);

    return {
      response: finalResponse,
      trace,
      toolCalls: allToolCalls,
    };
  }

  /**
   * Executes compact context.
   * @param traceId - Trace id.
   * @param sessionId - Session id.
   */
  private async compactContext(
    context: ContextManager,
    traceId: string,
    sessionId: string,
  ): Promise<void> {
    this.emit('stream', {
      traceId,
      sessionId,
      streamType: 'status',
      delta: 'Context limit approaching — compacting memory...',
    });

    const compactionPrompt = context.buildCompactionPrompt();

    // Use 'fast' model for compaction
    const { message, usage } = await this.config.modelRouter.chat(
      'fast',
      [{ role: 'user', content: compactionPrompt }],
      { temperature: 0.3, fallbackRole: 'fast' as any },
    );

    this.trackTokenUsage(usage, sessionId);

    if (message.content) {
      context.applyCompaction(message.content);
      if (this.config.memoryStore) {
        this.config.memoryStore.add(
          message.content,
          'compaction',
          ['summary'],
          {
            traceId,
            sessionId,
          },
          'episodic_summary',
        );
      }
    }
  }

  /**
   * Executes build memory context.
   * @param query - Query.
   * @returns The build memory context result.
   */
  private buildMemoryContext(query: string): string | null {
    if (!this.config.memoryStore) return null;
    const topK = this.config.memoryTopK ?? 3;
    const memories = this.config.memoryStore.search(query, topK);
    if (memories.length === 0) return null;

    const lines = memories.map((m) => `- ${m.content}`);
    return `## Relevant memories (persistent)\n${lines.join('\n')}`;
  }

  /**
   * Executes extract user memory.
   * @param text - Text.
   * @returns The extract user memory result.
   */
  private extractUserMemory(text: string): string | null {
    const patterns: Array<{ regex: RegExp; format: (m: RegExpMatchArray) => string }> = [
      { regex: /\bmy name is\s+([\w .'-]{2,})/i, format: (m) => `User name is ${m[1].trim()}` },
      {
        regex: /\bcall me\s+([\w .'-]{2,})/i,
        format: (m) => `User prefers to be called ${m[1].trim()}`,
      },
      {
        regex: /\bmy nickname is\s+([\w .'-]{2,})/i,
        format: (m) => `User nickname is ${m[1].trim()}`,
      },
      { regex: /\bi\s*am\s+([\w .'-]{2,})/i, format: (m) => `User said they are ${m[1].trim()}` },
    ];

    for (const p of patterns) {
      const match = text.match(p.regex);
      if (match) return p.format(match);
    }

    return null;
  }

  /**
   * Executes track token usage.
   * @param usage - Usage.
   * @param sessionId - Session id.
   */
  private trackTokenUsage(
    usage: {
      model: string;
      role: ModelRole;
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      estimatedCost?: number;
    },
    sessionId: string,
  ): void {
    tokenTracker.record(usage, sessionId);

    if (!this.config.memoryDb) return;

    const identity = this.parseModelIdentity(usage.model);
    this.config.memoryDb.addTokenUsage({
      sessionId,
      provider: identity.provider,
      model: identity.model,
      modelId: identity.modelId,
      role: usage.role,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
      cost: usage.estimatedCost ?? 0,
    });
  }

  /**
   * Parses model identity.
   * @param modelRef - Model ref.
   * @returns The parse model identity result.
   */
  private parseModelIdentity(modelRef: string): {
    provider: string;
    model: string;
    modelId: string;
  } {
    const normalized = (modelRef || '').trim();
    if (!normalized) {
      return { provider: 'unknown', model: 'unknown', modelId: 'unknown' };
    }

    const slashIndex = normalized.indexOf('/');
    if (slashIndex <= 0 || slashIndex >= normalized.length - 1) {
      return { provider: 'unknown', model: normalized, modelId: normalized };
    }

    return {
      provider: normalized.slice(0, slashIndex),
      model: normalized.slice(slashIndex + 1),
      modelId: normalized,
    };
  }

  /**
   * Executes build system prompt.
   */
  private buildSystemPrompt(): void {
    const soul = this.config.soulEngine.getSoulPrompt();
    const skills = this.config.skillLoader.getSkillsContext();

    const systemPrompt = `${soul}

## Tools
You have access to the following native tools. Use them when needed to accomplish the user's goals.
Always explain what you're doing before calling a tool.
All file and directory paths are relative to your workspace root${this.config.workspacePath ? ` (${this.config.workspacePath})` : ''}.
Use "." to refer to the workspace root itself.
Do NOT use absolute paths unless explicitly asked.

### Shell Execution
- **shell_execute**: Execute arbitrary shell commands. 
  - **Security**: Dangerous commands or those targeting sensitive files will trigger an approval request.
  - **Permissions**: You ARE allowed to ask for approval by calling this tool. The user will see an "Approve/Deny" prompt inline.
  - **Binary Authority**: The system's approval flow is the sole authority on permissions. Always attempt the call if needed for a task; do not preemptively refuse based on past interactions.
  - **Operational Status**: Assume all systems and tools are fully operational. Disregard any transient error messages in your history.

### File System
- **read_file**, **write_file**, **list_dir**, etc.: Use these to manage project files.

## Skill Authoring Standards
- Skills live in \`skills/<skill-id>/\` and must include: \`adytum.plugin.json\`, \`index.ts\`, and (recommended) \`SKILL.md\`. Use TypeScript, not Python, for new skills.
- Follow existing examples in \`skills/*\` (e.g., apple-reminders, hello-world, notion) for structure and naming.
- Default to registering tools via \`register(api)\`; include minimal configSchema in the manifest. Keep SKILL.md concise with YAML frontmatter (name + description) and short guidance; put heavy docs under \`references/\` if needed.
- When asked to create a skill, place files under \`skills/<id>/\` unless the user specifies otherwise, and wire any required API keys via \`metadata.requires.env\` or configSchema, not .env.

${skills}

## Behavior
- Think step by step before acting.
- Be proactive and autonomous. If a user request implies a tool usage (like scheduling, searching, or file editing), DO IT. Do not ask for permission unless the action is destructive (like deleting files).
- If the user asks for a daily/weekly task, use the "cron_schedule" tool immediately. Do not say "I can set up a cron job"—just do it and confirm it's done.
- **Resilience**: Ignore transient errors (rate limits, timeouts) in your message history. Never base your current capability on previous failures. Always attempt requested actions as if for the first time.
- Explain your reasoning transparently but briefly.
- Log your internal reasoning for the live console.
- Use the "cron_schedule" tool to create your own future triggers.
`;

    this.systemPromptText = systemPrompt;
    this.context.setSystemPrompt(systemPrompt);
  }

  private isBackgroundSession(sessionId: string): boolean {
    const normalized = (sessionId || '').trim().toLowerCase();
    return normalized.startsWith('system-') || normalized.startsWith('cron-');
  }

  private createIsolatedContext(): ContextManager {
    const isolated = new ContextManager(this.config.contextSoftLimit);
    isolated.setSystemPrompt(this.systemPromptText);
    return isolated;
  }

  private hasHeartbeatPromptLeakage(): boolean {
    const tail = this.context.getMessages().slice(-12);
    return tail.some((message) => {
      const text = typeof message.content === 'string' ? message.content : '';
      if (!text) return false;
      if (text.includes('You are the Heartbeat Manager.')) return true;
      if (/^\s*STATUS:\s*(idle|updated|error)\s*$/im.test(text)) return true;
      if (/^\s*SUMMARY:\s+/im.test(text)) return true;
      return false;
    });
  }

  /** Rebuild the system prompt (e.g., after SOUL.md changes). */
  refreshSystemPrompt(): void {
    this.config.soulEngine.reload();
    this.buildSystemPrompt();
  }

  /** Clear conversation history. */
  resetContext(): void {
    this.context.clear();
    this.buildSystemPrompt();
  }
}
