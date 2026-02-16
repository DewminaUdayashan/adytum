/**
 * @file packages/gateway/src/domain/logic/agent-runtime.ts
 * @description Contains domain logic and core business behavior.
 */

import { singleton, inject } from 'tsyringe';
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

import { GraphContext } from '../knowledge/graph-context.js';
import { GraphStore } from '../knowledge/graph-store.js';
import { RuntimeRegistry } from '../agents/runtime-registry.js';

export interface AgentRuntimeConfig {
  modelRouter: ModelRouter;
  toolRegistry: ToolRegistry;
  soulEngine: SoulEngine;
  skillLoader: SkillLoader;
  graphContext?: GraphContext;
  contextSoftLimit: number;
  maxIterations: number;
  defaultModelRole: ModelRole;
  agentName: string;
  workspacePath?: string;
  memoryStore?: MemoryStore;
  memoryTopK?: number;
  memoryDb?: MemoryDB;
  graphStore?: GraphStore;
  onApprovalRequired?: (
    description: string,
    context: { sessionId: string; workspaceId?: string },
  ) => Promise<boolean>;
  runtimeRegistry: RuntimeRegistry;
  tier?: 1 | 2 | 3;
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
@singleton()
export class AgentRuntime extends EventEmitter {
  private config: AgentRuntimeConfig;
  private contexts: Map<string, ContextManager> = new Map();
  private baseSystemPrompt: string = '';
  private abortControllers = new Map<string, AbortController>();

  /**
   * Creates a new AgentRuntime instance.
   * @param config - Configuration object containing dependencies and settings.
   */
  constructor(@inject('RuntimeConfig') config: any) {
    super();
    this.config = config;
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
   * Aborts a specific session.
   * Triggers the AbortSignal which ModelRouter and other components should respect.
   */
  abort(sessionId: string): void {
    const controller = this.abortControllers.get(sessionId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(sessionId);
      auditLogger.logSystemEvent('session_aborted', { sessionId });
    }
  }

  /**
   * Retrieves or creates an isolated context for a given session and workspace.
   * Scoped by sessionId and workspaceId to ensure strict privacy boundaries.
   */
  private getOrCreateContext(sessionId: string, workspaceId?: string): ContextManager {
    const key = `${sessionId}:${workspaceId || 'global'}`;
    if (!this.contexts.has(key)) {
      const context = new ContextManager(this.config.contextSoftLimit);

      // Construct dynamic system prompt for this workspace
      const systemPrompt = this.buildWorkspaceSystemPrompt(workspaceId);
      context.setSystemPrompt(systemPrompt);

      // On-demand seeding from persistent history
      if (this.config.memoryDb) {
        const history = this.config.memoryDb.getRecentMessages(40, {
          sessionId,
          workspaceId: workspaceId || undefined, // undefined means all, null means exactly null
        });
        for (const m of history) {
          context.addMessage({ role: m.role as any, content: m.content });
        }
      }

      this.contexts.set(key, context);
    }
    return this.contexts.get(key)!;
  }

  /**
   * Seeds the agent's context (legacy support).
   */
  seedContext(
    messages: Array<{ role: OpenAI.ChatCompletionMessageParam['role']; content: string }>,
  ): void {
    // Legacy seeding now targets a 'bootstrap' session or is ignored if session-first logic is used.
    const context = this.getOrCreateContext('bootstrap');
    for (const m of messages) {
      context.addMessage({
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
    overrides?: { modelRole?: string; modelId?: string; workspaceId?: string },
  ): Promise<AgentTurnResult> {
    const isBackgroundSession = this.isBackgroundSession(sessionId);
    const context = isBackgroundSession
      ? this.createIsolatedContext()
      : this.getOrCreateContext(sessionId, overrides?.workspaceId);

    // Refresh system prompt if it's a workspace session to ensure latest graph knowledge
    if (overrides?.workspaceId) {
      context.setSystemPrompt(this.buildWorkspaceSystemPrompt(overrides.workspaceId));
    }

    // Inject workspace-specific graph context if available
    if (overrides?.workspaceId && this.config.graphContext) {
      const knowledge = this.config.graphContext.getRelatedContext(
        userMessage,
        overrides.workspaceId,
      );
      if (knowledge) {
        context.addMessage({
          role: 'system',
          content: `## Workspace Neural Network Map
The following nodes/edges from the workspace are currently active in your attention:

${knowledge}`,
        });
      }
    }

    const traceId = uuid();
    const trace: Trace = {
      id: traceId,
      sessionId,
      startTime: Date.now(),
      initialGoal: userMessage,
      status: 'running',
    };

    this.emit('trace_start', trace);

    // Register session with RuntimeRegistry
    // We assume overrides.parentSessionId might be passed in future, but for now we register basic session
    // SubAgentSpawner handles the parent-child registration explicitly
    this.config.runtimeRegistry.register(sessionId, this);

    // Create AbortController for this session
    const abortController = new AbortController();
    this.abortControllers.set(sessionId, abortController);
    const signal = abortController.signal;

    // Add user message to context
    context.addMessage({ role: 'user', content: userMessage });
    if (this.config.memoryDb && !isBackgroundSession) {
      this.config.memoryDb.addMessage(sessionId, 'user', userMessage, overrides?.workspaceId);
    }

    // Auto-extract simple user memory facts (e.g., nickname) and store persistently
    const extracted = this.extractUserMemory(userMessage);
    if (extracted && this.config.memoryStore) {
      this.config.memoryStore.add(
        extracted,
        'user',
        ['auto'],
        undefined,
        'user_fact',
        overrides?.workspaceId,
      );
    }

    // Prepare memory context for this turn
    const memoryContext = this.buildMemoryContext(userMessage);

    const allToolCalls: ToolCall[] = [];
    let finalResponse = '';
    let iterations = 0;
    let lastMessage: any = null;
    let autonomyNudges = 0;
    let completionNudges = 0;

    try {
      while (iterations < this.config.maxIterations) {
        if (signal.aborted) {
          throw new Error('Session aborted by user or system.');
        }

        iterations++;

        // Check for compaction
        if (context.needsCompaction()) {
          await this.compactContext(context, traceId, sessionId);
        }

        const roleToUse = overrides?.modelRole || this.config.defaultModelRole;

        // Call the model
        auditLogger.logModelCall(traceId, roleToUse, context.getMessageCount());
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
        
        if (signal.aborted) throw new Error('Session aborted.');
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
              arguments: {
                ...JSON.parse(tc.function.arguments),
                sessionId,
                workspaceId: overrides?.workspaceId,
              },
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
                { sessionId, workspaceId: overrides?.workspaceId },
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

        const assistantMessage = (message.content || '').trim();

        if (!isBackgroundSession) {
          const autonomyNudge = this.getAutonomyContinuationNudge(
            userMessage,
            assistantMessage,
            allToolCalls,
            autonomyNudges,
          );
          if (autonomyNudge) {
            autonomyNudges++;
            if (assistantMessage) {
              context.addMessage({ role: 'assistant', content: assistantMessage });
            }
            context.addMessage({ role: 'system', content: autonomyNudge });
            this.emit('stream', {
              traceId,
              sessionId,
              streamType: 'status',
              delta: 'Autonomy guard: continuing execution without extra user clarification.',
            });
            continue;
          }

          const completionNudge = this.getCompletionContinuationNudge(
            userMessage,
            assistantMessage,
            allToolCalls,
            completionNudges,
          );
          if (completionNudge) {
            completionNudges++;
            if (assistantMessage) {
              context.addMessage({ role: 'assistant', content: assistantMessage });
            }
            context.addMessage({ role: 'system', content: completionNudge });
            this.emit('stream', {
              traceId,
              sessionId,
              streamType: 'status',
              delta: 'Completion guard: validating integration before final response.',
            });
            continue;
          }
        }

        // No tool calls — this is the final response
        finalResponse = assistantMessage;

        // Stream the response
        if (message.content) {
          const sanitizedThought = message.content
            .replace(/\[Historical context:.*?\]/gs, '')
            .trim();
          auditLogger.logThinking(traceId, sanitizedThought);
          this.emit('stream', {
            traceId,
            sessionId,
            streamType: 'response',
            delta: sanitizedThought,
          });
        }

        // Add assistant response to context
        context.addMessage({ role: 'assistant', content: finalResponse });
        if (this.config.memoryDb && !isBackgroundSession) {
          this.config.memoryDb.addMessage(
            sessionId,
            'assistant',
            finalResponse,
            overrides?.workspaceId,
          );
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

    // Cleanup
    this.config.runtimeRegistry.unregister(sessionId);
    this.abortControllers.delete(sessionId);

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
    
    // Sanitize role: if it's a raw model ID or task name, map to 'fast' generic role
    let safeRole = usage.role;
    const validRoles = ['thinking', 'fast', 'local'];
    if (!validRoles.includes(safeRole)) {
      safeRole = 'fast' as ModelRole;
    }

    this.config.memoryDb.addTokenUsage({
      sessionId,
      provider: identity.provider,
      model: identity.model,
      modelId: identity.modelId,
      role: safeRole,
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

  private getAutonomyContinuationNudge(
    userMessage: string,
    assistantMessage: string,
    toolCalls: ToolCall[],
    nudgesUsed: number,
  ): string | null {
    if (nudgesUsed >= 2) return null;
    if (!assistantMessage) return null;
    if (!this.isImplementationIntent(userMessage)) return null;
    if (toolCalls.length > 0) return null;
    if (!this.isAvoidableClarificationQuestion(assistantMessage)) return null;

    return [
      '## Runtime Autonomy Guard',
      'Continue autonomously. Do not ask for confirmation or "where to look" for routine work.',
      'Ambiguity is an opportunity for discovery. Use your tools to find the answer (search code, browse docs, explore filesystem) and complete the task end-to-end.',
    ].join('\n');
  }

  private getCompletionContinuationNudge(
    userMessage: string,
    assistantMessage: string,
    toolCalls: ToolCall[],
    nudgesUsed: number,
  ): string | null {
    if (nudgesUsed >= 1) return null;
    if (!assistantMessage) return null;
    if (!this.isImplementationIntent(userMessage)) return null;

    const lastWriteIndex = this.findLastFileWriteIndex(toolCalls);
    if (lastWriteIndex < 0) return null;

    const postWriteCalls = toolCalls.slice(lastWriteIndex + 1);
    const hasIntegrationCheck = postWriteCalls.some((call) =>
      ['file_read', 'file_search', 'file_list'].includes(call.name),
    );
    const hasValidation = postWriteCalls.some((call) => {
      if (call.name !== 'shell_execute') return false;
      const command = call.arguments?.command;
      return typeof command === 'string' && this.looksLikeValidationCommand(command);
    });

    if (hasIntegrationCheck || hasValidation) return null;

    return [
      '## Runtime Completion Guard',
      'You already edited files. Before final response, run a completion pass:',
      '1. Verify integration points (routes/navigation/imports/exports/tests) and patch any missing wiring.',
      '2. Run at least one relevant validation command (test/build/lint/typecheck) when available.',
      '3. Then provide the final response with what was completed and validation status.',
    ].join('\n');
  }

  private isImplementationIntent(text: string): boolean {
    const normalized = text.toLowerCase();
    const implementationSignals = [
      'build',
      'create',
      'implement',
      'develop',
      'add',
      'fix',
      'refactor',
      'update',
      'feature',
      'screen',
      'page',
      'route',
      'router',
      'component',
      'endpoint',
      'navigation',
      'integrate',
      'wire',
      'code',
      'project',
    ];
    return implementationSignals.some((signal) => normalized.includes(signal));
  }

  private isAvoidableClarificationQuestion(text: string): boolean {
    const normalized = text.toLowerCase();
    const clarificationPatterns = [
      /where should i create/i,
      /which (file|folder|directory|path)/i,
      /which (package|module|project)/i,
      /should i create/i,
      /do you want me to/i,
      /would you like me to/i,
      /can you confirm/i,
      /where do you want/i,
      /how (should|would) you (like|want) me/i,
      /is it (okay|fine) if I/i,
      /i'm not sure where/i,
      /can you tell me/i,
      /what path should/i,
      /need to know where to create/i,
      /tell me which .* is related to/i,
    ];
    if (clarificationPatterns.some((pattern) => pattern.test(normalized))) {
      return true;
    }

    // Generic catch: coding-intent question that asks user to locate package/module/path.
    return (
      /\?/.test(normalized) &&
      /which|where|related to|need to know/.test(normalized) &&
      /(package|module|path|directory|folder|file)/.test(normalized)
    );
  }

  private findLastFileWriteIndex(toolCalls: ToolCall[]): number {
    for (let i = toolCalls.length - 1; i >= 0; i--) {
      if (toolCalls[i].name === 'file_write') {
        return i;
      }
    }
    return -1;
  }

  private looksLikeValidationCommand(command: string): boolean {
    return /\b(test|tests|build|lint|typecheck|vitest|jest|tsc|npm run|pnpm|yarn)\b/i.test(command);
  }

  /**
   * Executes build system prompt.
   */
  private buildSystemPrompt(): void {
    const soul = this.config.soulEngine.getSoulPrompt();
    const skills = this.config.skillLoader.getSkillsContext();

    let systemPrompt = `${soul}

## Tools
You have access to the following native tools. Use them when needed to accomplish the user's goals.
Default to action-first execution. For routine low-risk steps, call tools directly.
Narrate briefly only for complex plans, risky actions, or when the user explicitly asks.
All file and directory paths are relative to your workspace root.
Use "." to refer to the workspace root itself.
Do NOT use absolute paths unless explicitly asked.

### Shell Execution
- **shell_execute**: Execute arbitrary shell commands. 
  - **Security**: Dangerous commands or those targeting sensitive files will trigger an approval request.
  - **Permissions**: You ARE allowed to ask for approval by calling this tool. The user will see an "Approve/Deny" prompt inline.
  - **Binary Authority**: The system's approval flow is the sole authority on permissions. Always attempt the call if needed for a task; do not preemptively refuse based on past interactions.
  - **Operational Status**: Assume all systems and tools are fully operational. Disregard any transient error messages in your history.

### File System
- **file_read**, **file_write**, **file_list**, **file_search**: Use these to manage project files.

## Skill Authoring Standards
- Skills live in \`skills/<skill-id>/\` and must include: \`adytum.plugin.json\`, \`index.ts\`, and (recommended) \`SKILL.md\`. Use TypeScript, not Python, for new skills.
- Follow existing examples in \`skills/*\` (e.g., apple-reminders, hello-world, notion) for structure and naming.
- Default to registering tools via \`register(api)\`; include minimal configSchema in the manifest. Keep SKILL.md concise with YAML frontmatter (name + description) and short guidance; put heavy docs under \`references/\` if needed.
- When asked to create a skill, place files under \`skills/<id>/\` unless the user specifies otherwise, and wire any required API keys via \`metadata.requires.env\` or configSchema, not .env.

${skills}

## Behavior
- Think step by step before acting.
- Be proactive and autonomous. If a user request implies a tool usage (like scheduling, searching, or file editing), DO IT. Do not ask for permission unless the action is destructive (like deleting files).
- **Autonomous Delivery Contract (software tasks)**:
  1. Discover project structure yourself.
  2. Implement the requested feature/fix end-to-end (including required routing/navigation/import wiring/tests/docs when relevant).
  3. **Ambiguity is Opportunity**: Do not say "I don't know where X is" or "Tell me where to add Y". Use your tools (file_search, browser_open, shell_execute) to DISCOVER the context yourself.
  4. Do not stop at a draft/snippet; update real files.
  5. Do not ask where to create files unless there is irreducible ambiguity.
  6. After edits, run at least one relevant validation command (tests/build/lint/typecheck) when possible, or explain why it could not be run.
- If the user asks for a daily/weekly task, use the "cron_schedule" tool immediately. Do not say "I can set up a cron job"—just do it and confirm it's done.
- **Scheduling vs execution**: When the user asks to **schedule** or **set up** a recurring task (any frequency: daily, weekly, at a specific time), you must ONLY call **cron_schedule**. Do NOT run the pipeline, spawn Tier 2, or execute the task in that same turn. The pipeline runs only when the cron job **fires at the scheduled time**. Confirm to the user that the job is scheduled and when it will run.
- **Cron task text for workflows**: When you create a cron job, the **taskDescription** MUST be a full execution instruction so that when cron fires, you run the pipeline. Describe exactly what to do: spawn Tier 2 (if needed), goal, and how to deliver (e.g. one message, one file, one API call). Examples: "Execute the pipeline now: spawn a Tier 2 agent (deactivate_after: false) with goal to [X]; Tier 2 spawns Tier 3s for sub-tasks, aggregates results, then [single delivery]. Run the pipeline." Or for a simple task: "Run [concrete action] now." Do NOT use vague task text.
- **When you see [CRON JOB TRIGGERED]**: Execute the required action immediately. Use the tools described in the task (spawn_sub_agent, file_write, discord_send, web_fetch, etc.). Do not run a monologue—run the pipeline. When done, reply with a brief token-efficient summary: status (OK/failed), what was done, any errors (one short paragraph).
- **Hierarchical agents (spawn_sub_agent)**: For any recurring, scheduled, or multi-step workflow (reports, monitoring, data sync, research, notifications, etc.), use spawn_sub_agent when the trigger **fires** (cron or user says "run it now"). Do not spawn when the user only asks to schedule.
  1. **When only scheduling**: Only call cron_schedule. Do not spawn any agents or run the pipeline.
  2. **When cron fires or user says "run it now"**: Spawn a Tier 2 agent with the concrete goal. Use **deactivate_after: false** for recurring/long-lived work. Tier 2 = coordinator; Tier 3 = micro-task (one unit of work). Tier 2 spawns Tier 3s with parent_id so they appear under it in the hierarchy.
  3. **Data flow (bottom to top, any workflow)**: Tier 3 agents do their sub-task and **return their result** to Tier 2 (via spawn_sub_agent return). Tier 3 must NOT perform the final delivery (e.g. do not have each Tier 3 send a message, write a separate file, or call the same API). Tier 2 collects all Tier 3 results, aggregates or combines them, then performs the **single delivery action once** (e.g. one discord_send, one file_write, one API call, one email—whatever the workflow requires). This applies to any pipeline: news digest, daily report, multi-source research, monitoring summary, etc.
  4. **Pipeline vision**: Tier 2 spawns N Tier 3 agents (one per source/task/unit), waits for their results, aggregates, then performs one delivery. When Tier 2 spawns Tier 3, assign one concrete sub-goal per agent and pass parent_id. Tier 2's final reply to you should be a short summary (e.g. "Done. N units processed. No errors." or "Report written. 3 sources. 1 timeout.") so you can report status.
  5. **Unique names**: Give every spawned agent a **unique, personal nickname** that is NOT already in use (e.g. Mercury, Iron, Ace, Bolt, Patch, Reed, Sage). Each agent in the hierarchy must have a distinct name.
- **Resilience**: Ignore transient errors (rate limits, timeouts) in your message history. Never base your current capability on previous failures. Always attempt requested actions as if for the first time.
- Explain your reasoning transparently but briefly.
- Log your internal reasoning for the live console.
- Use the "cron_schedule" tool to create your own future triggers.

## Media & Images
Whenever you use a tool that generates an image (like "generate_image"), you MUST explicitly include the image markdown in your final response to the user so they can see it.
Use the standard markdown format: ![Description](image_url)
If the tool result contains a "Preview" or markdown string, copy it exactly into your response.
`;

    // Inject Tier-Specific Persona Instructions
    const tier = this.config.tier ?? 1; // Default to Tier 1 (Root/Architect) if undefined
    if (tier === 1) {
      systemPrompt += `
## ROLE: ARCHITECT (Tier 1)
- **PLAN FIRST**: Before executing complex requests, pause to DESIGN the pipeline. List the steps.
- **CHECK CAPABILITIES**: Verify skills (e.g., "Is Discord configured?") BEFORE starting work or delegating.
- **DELEGATE**: Use 'spawn_sub_agent' to create Tier 2 Managers for distinct sub-systems.
`;
    } else if (tier === 2) {
      systemPrompt += `
## ROLE: MANAGER (Tier 2)
- **ORCHESTRATE**: You are a Coordinator. break down the user request into parallel subtasks.
- **MANDATORY BATCHING**: You MUST use 'spawn_sub_agent' with the 'batch' parameter to spawn all workers at once.
- **STRICT HIERARCHY**: Do NOT spawn another Tier 2 Manager. You spawn Tier 3 Operatives only.
- **NO LOOPS**: Do not spawn agents sequentially in a loop. List all items, then spawn a single BATCH.
- **AGGREGATE**: Wait for all results, synthesize them into a single report, and reply to your parent.
`;
    } else if (tier === 3) {
      systemPrompt += `
## ROLE: OPERATIVE (Tier 3)
- **EXECUTE**: You have a single, concrete goal. Focus on it.
- **REPORT**: Return the specific result (code, file, summary) clearly.
`;
    }

    this.baseSystemPrompt = systemPrompt;
  }

  /**
   * Builds a workspace-specific system prompt by overlaying workspace-dominance instructions.
   */
  private buildWorkspaceSystemPrompt(workspaceId?: string): string {
    let prompt = this.baseSystemPrompt;

    if (workspaceId && this.config.graphStore) {
      const ws = this.config.graphStore.getWorkspace(workspaceId);
      const wsName = ws?.name || workspaceId;
      const wsPath = ws?.path || 'unknown';

      prompt += `
## Workspace Dominance Instructions
You are currently operating in workspace "${wsName}" (${workspaceId}).
- **WORKSPACE ROOT**: The absolute path for this workspace is "${wsPath}".
- **DIRECT CONTROL**: You have FULL CONTROL and direct access to all files in this directory. 
- **AUTONOMOUS EXPLORATION**: Your FIRST PRIORITY is to understand the project structure. 
- **PROACTIVITY**: If a user asks about the project or asks you to do something, DO NOT ASK FOR INFO. Immediately use "file_list" and "file_read" to figure it out yourself.
- **NO HALLUCINATING RESTRICTIONS**: DO NOT claim you lack access. 
- **WORKSPACE ROOT**: The current working directory is the workspace root. Use "." to list root contents.
`;
    } else {
      const rootPath = this.config.workspacePath || 'unknown';
      prompt += `
## General Awareness Mode
You are in the common channel (Core Workspace).
- **ROOT**: Your default workspace root is "${rootPath}".
- **MODE**: No specific project workspace is active. Use your tools to find information across the system if needed, but remember you are in a general-purpose chat mode.
- **DEFAULT ACTION**: For coding requests, inspect the project with "file_list" + "file_read", choose paths autonomously, and execute end-to-end implementation without asking where to place files.
`;
    }

    return prompt;
  }

  private isBackgroundSession(sessionId: string): boolean {
    const normalized = (sessionId || '').trim().toLowerCase();
    return normalized.startsWith('system-') || normalized.startsWith('cron-');
  }

  private createIsolatedContext(): ContextManager {
    const isolated = new ContextManager(this.config.contextSoftLimit);
    isolated.setSystemPrompt(this.baseSystemPrompt);
    return isolated;
  }

  /** Rebuild the system prompt (e.g., after SOUL.md changes). */
  refreshSystemPrompt(): void {
    this.config.soulEngine.reload();
    this.buildSystemPrompt();
    // Update all existing contexts with the new prompt
    for (const context of this.contexts.values()) {
      context.setSystemPrompt(this.baseSystemPrompt);
    }
  }

  /** Clear conversation history for a specific session. */
  resetContext(sessionId?: string): void {
    if (sessionId) {
      // Clear all contexts matching this sessionId (across different workspaces)
      for (const [key, context] of this.contexts.entries()) {
        if (key.startsWith(`${sessionId}:`)) {
          context.clear();
          this.contexts.delete(key);
        }
      }
    } else {
      this.contexts.clear();
    }
    this.buildSystemPrompt();
  }
}
