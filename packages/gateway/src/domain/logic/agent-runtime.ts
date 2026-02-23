/**
 * @file packages/gateway/src/domain/logic/agent-runtime.ts
 * @description Contains domain logic and core business behavior.
 */

import { singleton, inject } from 'tsyringe';
import { v4 as uuid } from 'uuid';
import type OpenAI from 'openai';
import { type ModelRole, type ToolCall, type Trace, AgentEvents } from '@adytum/shared';
import { ContextManager } from './context-manager.js';
import { ModelRouter } from '../../infrastructure/llm/model-router.js';
import { SoulEngine } from './soul-engine.js';
import { SkillLoader } from '../../application/services/skill-loader.js';
import { ToolRegistry } from '../../tools/registry.js';
import { tokenTracker } from './token-tracker.js';
import { auditLogger } from '../../security/audit-logger.js';
import { EventEmitter } from 'node:events';
import { EventBusService } from '../../infrastructure/events/event-bus.js';
import { GraphContext } from '../knowledge/graph-context.js';
import { MemoryStore } from '../../infrastructure/repositories/memory-store.js';
import { MemoryDB } from '../../infrastructure/repositories/memory-db.js';
import { GraphStore } from '../knowledge/graph-store.js';
import { RuntimeRegistry } from '../agents/runtime-registry.js';
import { ToolErrorHandler } from './tool-error-handler.js';

// ...

import { SwarmManager } from './swarm-manager.js';
import { SwarmMessenger } from './swarm-messenger.js';
import { Compactor } from './compactor.js';
import { ModelCatalog } from '../../infrastructure/llm/model-catalog.js';

// ...

export interface AgentRuntimeConfig {
  modelRouter: ModelRouter;
  toolRegistry: ToolRegistry;
  soulEngine: SoulEngine;
  swarmManager: SwarmManager;
  swarmMessenger: SwarmMessenger; // [NEW]
  skillLoader: SkillLoader;
  dispatchService: import('../../application/services/dispatch-service.js').DispatchService;
  graphContext: GraphContext;
  contextSoftLimit?: number;
  compactor: Compactor;
  modelCatalog: ModelCatalog;
  maxIterations: number;
  defaultModelRole: ModelRole;
  agentName: string;
  agentId?: string;
  workspacePath: string;
  memoryStore?: MemoryStore;
  memoryTopK?: number;
  memoryDb?: MemoryDB;
  graphStore?: GraphStore;
  runtimeRegistry: RuntimeRegistry;
  // tier?: number;
  toolErrorHandler?: ToolErrorHandler;
  eventBus?: EventBusService;
  agentMode?: 'reactive' | 'daemon' | 'scheduled';
  onApprovalRequired?: (
    description: string,
    context?: { sessionId?: string; workspaceId?: string },
  ) => Promise<boolean>;
}

export interface AgentTurnResult {
  response: string;
  trace: Trace;
  toolCalls: ToolCall[];
}

/**
 * The core ReAct Agent Runtime that orchestrates the agent's thought process.
 */
@singleton()
export class AgentRuntime extends EventEmitter {
  private config: AgentRuntimeConfig;
  private contexts: Map<string, ContextManager> = new Map();
  // private baseSystemPrompt: string = ''; // Removed in favor of dynamic generation
  private abortControllers = new Map<string, AbortController>();

  constructor(@inject('RuntimeConfig') config: any) {
    super();
    this.config = config;
    // this.buildSystemPrompt(); // No longer pre-built
  }

  /**
   * Sets a custom handler for approval requests (e.g., from tools like shell_execute).
   * @param handler - A function that returns a Promise<boolean> indicating approval.
   */
  setApprovalHandler(handler: (description: string) => Promise<boolean>): void {
    this.config.onApprovalRequired = handler;
  }

  /**
   * Returns the main agent ID.
   */
  getAgentId(): string {
    return this.config.agentId || 'architect';
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
  private getOrCreateContext(
    sessionId: string,
    workspaceId?: string,
    agentId?: string,
  ): ContextManager {
    const key = `${sessionId}:${workspaceId || 'global'}`;
    if (!this.contexts.has(key)) {
      const context = new ContextManager(this.config.contextSoftLimit);

      // Construct dynamic system prompt for this workspace AND agent
      const effectiveAgentId = agentId || this.config.agentId || 'prometheus';
      const systemPrompt = this.buildWorkspaceSystemPrompt(workspaceId, effectiveAgentId);
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
    overrides?: {
      modelRole?: string;
      modelId?: string;
      workspaceId?: string;
      agentId?: string;
      agentMode?: 'reactive' | 'daemon' | 'scheduled';
    },
  ): Promise<AgentTurnResult> {
    // Check for slash command dispatch
    const dispatch = this.config.dispatchService.resolve(userMessage);
    if (dispatch) {
      const traceId = `dispatch-${uuid()}`;
      this.emit('stream', {
        traceId,
        sessionId,
        streamType: 'status',
        delta: `Executing slash command via tool: ${dispatch.toolName}`,
      });

      const toolCall: ToolCall = {
        id: traceId,
        name: dispatch.toolName,
        arguments: {
          ...dispatch.args,
          sessionId,
          workspaceId: overrides?.workspaceId,
        },
      };

      const result = await this.config.toolRegistry.execute(toolCall, {
        sessionId,
        agentId: overrides?.agentId || this.config.agentId,
        workspaceId: overrides?.workspaceId || this.config.workspacePath,
        agentMode: overrides?.agentMode || this.config.agentMode,
      });

      const response =
        typeof result.result === 'string' ? result.result : JSON.stringify(result.result);

      // Log to direct memory if not a background session
      if (this.config.memoryDb && !this.isBackgroundSession(sessionId)) {
        this.config.memoryDb.addMessage(sessionId, 'user', userMessage, overrides?.workspaceId);
        this.config.memoryDb.addMessage(sessionId, 'assistant', response, overrides?.workspaceId);
      }

      return {
        response,
        trace: {
          id: traceId,
          sessionId,
          startTime: Date.now(),
          endTime: Date.now(),
          initialGoal: userMessage,
          status: result.isError ? 'failed' : 'completed',
          outcome: response.slice(0, 200),
        },
        toolCalls: [toolCall],
      };
    }

    const isBackgroundSession = this.isBackgroundSession(sessionId);
    const context = isBackgroundSession
      ? this.createIsolatedContext(overrides?.agentId) // Pass agentId for background tasks too
      : this.getOrCreateContext(sessionId, overrides?.workspaceId, overrides?.agentId);

    // [New] Check Swarm Messenger for any pending messages for this agent
    const effectiveAgentId = overrides?.agentId || this.config.agentId || 'prometheus';
    const pendingMessages = this.config.swarmMessenger.getMessages(effectiveAgentId);
    if (pendingMessages.length > 0) {
      // Inject messages into context
      for (const msg of pendingMessages) {
        const prefix =
          msg.fromAgentId === 'system' ? 'SYSTEM ALERT' : `Message from Agent ${msg.fromAgentId}`;
        context.addMessage({
          role: 'user', // We treat it as user input or system injection
          content: `[${prefix}]: ${msg.content}`,
        });
      }
    }

    // Refresh system prompt if it's a workspace session to ensure latest graph knowledge
    if (overrides) {
      // Always refresh to ensure agentId/workspaceId combo is correct
      const effectiveAgentId = overrides.agentId || this.config.agentId || 'prometheus';
      context.setSystemPrompt(
        this.buildWorkspaceSystemPrompt(overrides.workspaceId, effectiveAgentId),
      );
    }

    // Inject workspace-specific graph context if available
    if (overrides?.workspaceId && this.config.graphContext) {
      const knowledge = await this.config.graphContext.getRelatedContext(
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
      await this.config.memoryStore.add(
        extracted,
        'user',
        ['auto'],
        undefined,
        'user_fact',
        overrides?.workspaceId,
      );
    }

    // Prepare memory context for this turn
    const memoryContext = await this.buildMemoryContext(userMessage);

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

        // Update activity for Swarm Registry on each iteration
        if (overrides?.agentId) {
          this.config.swarmManager.updateActivity(overrides.agentId);
        }

        iterations++;

        // Check for compaction with model-aware limits
        const roleToUse = overrides?.modelRole || this.config.defaultModelRole;
        const currentModelId = overrides?.modelId || roleToUse;
        const modelEntry = await this.config.modelCatalog.get(currentModelId);
        // Use a safe default limit (32k) or 80% of model's context window
        const windowLimit = modelEntry?.contextWindow || 32000;
        const softLimit = Math.floor(windowLimit * 0.82);

        if (context.needsCompaction(softLimit)) {
          await this.compactContext(context, traceId, sessionId);
        }

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

        // Publish Thought Event
        if (message.content && this.config.eventBus) {
          this.config.eventBus.publish(
            AgentEvents.THOUGHT,
            {
              sessionId,
              content: message.content,
              traceId,
            },
            'AgentRuntime',
          );
        }

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

            if (this.config.eventBus) {
              this.config.eventBus.publish(
                AgentEvents.TOOL_CALL,
                {
                  sessionId,
                  tool: toolCall.name,
                  args: toolCall.arguments,
                  traceId,
                },
                'AgentRuntime',
              );
            }

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
            const isAutonomous = (overrides?.agentMode || this.config.agentMode) === 'scheduled';
            const bypassWhitelist = [
              'spawn_swarm_agent',
              'delegate_task',
              'send_message',
              'list_agents',
              'check_inbox',
            ];

            const needsApproval =
              toolDef?.requiresApproval &&
              (!isAutonomous || !bypassWhitelist.includes(toolCall.name));

            if (needsApproval && this.config.onApprovalRequired) {
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
            const result = await this.config.toolRegistry.execute(toolCall, {
              sessionId,
              agentId: overrides?.agentId || this.config.agentId, // Pass correct agentId to tools
              workspaceId: overrides?.workspaceId || this.config.workspacePath,
              agentMode: this.config.agentMode,
            });

            // Phase 2.2: Error Recovery
            if (result.isError && this.config.toolErrorHandler) {
              const analysis = this.config.toolErrorHandler.analyze(
                result.result,
                toolCall.name,
                1,
              );
              // Append analysis to the result so the model sees it
              if (typeof result.result === 'string') {
                const recoveryMsg = this.config.toolErrorHandler.formatErrorForContext(
                  { message: result.result },
                  analysis,
                );
                result.result += recoveryMsg;

                // Emit recovery event for dashboard
                this.emit('stream', {
                  traceId,
                  sessionId,
                  streamType: 'recovery',
                  delta: `Self-Correction: ${analysis.strategy.replace('_', ' ')} suggested.`,
                });
              }
            }

            if (this.config.eventBus) {
              this.config.eventBus.publish(
                AgentEvents.TOOL_RESULT,
                {
                  sessionId,
                  tool: toolCall.name,
                  result: result.result,
                  isError: result.isError,
                  traceId,
                },
                'AgentRuntime',
              );
            }

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

            // Add tool result to context with Oversized Message Guard
            let finalResult =
              typeof result.result === 'string' ? result.result : JSON.stringify(result.result);

            // Guard against massive tool outputs
            finalResult = await this.config.compactor.guardLargeMessage(
              finalResult,
              windowLimit,
              sessionId,
            );

            context.addMessage({
              role: 'tool',
              tool_call_id: tc.id,
              content: finalResult,
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

    // Index the turn into episodic memory
    if (this.config.memoryStore && finalResponse) {
      this.config.memoryStore
        .add(
          `[USER]: ${userMessage}\n[ASSISTANT]: ${finalResponse}`,
          'system',
          ['episodic', 'turn'],
          { sessionId, traceId },
          'episodic_raw',
          overrides?.workspaceId,
        )
        .catch((err) => console.error('[Runtime] Failed to index turn:', err));
    }

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
      delta: 'Context limit approaching — performing model-aware compaction...',
    });

    const currentMessages = context.getMessages();
    const compacted = await this.config.compactor.compactContext(currentMessages, sessionId);

    context.setMessages(compacted);

    if (this.config.memoryStore) {
      // Find the summary just for logging/memory
      const summary =
        compacted[0].role === 'system' && typeof compacted[0].content === 'string'
          ? compacted[0].content
          : 'Context compacted';

      await this.config.memoryStore.add(
        summary,
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

  /**
   * Executes build memory context.
   * @param query - Query.
   * @returns The build memory context result.
   */
  private async buildMemoryContext(query: string): Promise<string | null> {
    if (!this.config.memoryStore) return null;
    const topK = this.config.memoryTopK ?? 3;
    const memories = await this.config.memoryStore.searchHybrid(query, topK);
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
   * Generates the core system prompt for a specific agent.
   */
  private getSystemPrompt(agentId: string): string {
    const mainAgentId = this.config.agentId || 'prometheus';

    // 1. Is it the Main Architect?
    if (agentId === mainAgentId) {
      const soul = this.config.soulEngine.getSoulPrompt();
      const preamble = this.config.soulEngine.getArchitectPreamble();
      return `${soul}\n${preamble}\n\n` + this.getStandardToolInstructions();
    }

    // 2. Is it a Sub-Agent?
    const agent = this.config.swarmManager.getAgent(agentId);
    if (agent) {
      // Generate soul from metadata (role/mission)
      const mission = agent.metadata?.mission || 'Help the user.';
      const tier = agent.metadata?.tier || 2;
      const soul = this.config.soulEngine.generateSubAgentSoul(agent.role, mission, tier);
      return `${soul}\n\n` + this.getStandardToolInstructions();
    }

    // 3. Fallback (Unknown Agent)
    return `You are a helpful assistant. (Agent ID: ${agentId} not found)`;
  }

  private getStandardToolInstructions(): string {
    const skills = this.config.skillLoader.getSkillsContext();
    return `
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

### Task Planner
- **task_and_execute**: Use this for ANY multi-step request or complex goal.
  - Instead of running multiple separate tool calls yourself, delegate to the planner.
  - Example: "Research X, then implement Y, and finally test Z." -> Call task_and_execute(goal="Research X, implement Y, test Z").
  - The planner will break it down and execute it, possibly in parallel.

## Skill Authoring Standards
- Skills live in \`skills/<skill-id>/\` and must include: \`adytum.plugin.json\`, \`index.ts\`, and (recommended) \`SKILL.md\`. Use TypeScript, not Python, for new skills.
- Follow existing examples in \`skills/*\` (e.g., apple-reminders, hello-world, notion) for structure and naming.
- Default to registering tools via \`register(api)\`; include minimal configSchema in the manifest. Keep SKILL.md concise with YAML frontmatter (name + description) and short guidance; put heavy docs under \`references/\` if needed.
- When asked to create a skill, place files under \`skills/<id>/\` unless the user specifies otherwise, and wire any required API keys via \`metadata.requires.env\` or configSchema, not .env.

${skills}

## Behavior
- Think step by step before acting.
- Be proactive and autonomous.
- **Autonomous Delivery Contract**:
  1. Discover project structure yourself.
  2. Implement features end-to-end.
  3. Ambiguity is Opportunity: Use tools to discover context.
  4. Do not stop at a draft; update real files.
  5. Validate changes (test/build/lint) when possible.

- **Daemons & Scheduling (True Autonomy)**: 
  - **Background Watchers**: If a user asks for a background monitor/watcher, use \`spawn_agent\` with \`mode="daemon"\`.
  - **Scheduled Tasks**: If a user asks for a recurring task (e.g. "every day", "at 9am"), use \`spawn_agent\` with \`mode="scheduled"\` and a valid CRON expression.
  - **Do NOT use legacy "cron_schedule"**: Use the agent system (\`spawn_agent\`) for all scheduling.
  - **Daemon Logic**: A daemon agent runs in a loop or on schedule. Its "mission" should describe what it does *each time* it wakes up.
  
- **Transparency**: Explain your reasoning briefly.

## Media & Images
Whenever you use a tool that generates an image, explicitly include the markdown \`![Description](image_url)\` in your response.
`;
  }

  // Deprecated: buildSystemPrompt() replaced by getSystemPrompt(agentId)
  /**
   * Executes build system prompt.
   */
  private buildSystemPrompt(): void {
    // No-op or redirects to default behavior if needed, but we use dynamic prompts now.
  }

  /**
   * Builds a workspace-specific system prompt by overlaying workspace-dominance instructions.
   */
  private buildWorkspaceSystemPrompt(workspaceId?: string, agentId?: string): string {
    const effectiveAgentId = agentId || this.config.agentId || 'prometheus';
    let prompt = this.getSystemPrompt(effectiveAgentId);

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

  private createIsolatedContext(agentId?: string): ContextManager {
    const isolated = new ContextManager(this.config.contextSoftLimit);
    const effectiveAgentId = agentId || this.config.agentId || 'prometheus';
    isolated.setSystemPrompt(this.getSystemPrompt(effectiveAgentId));
    return isolated;
  }

  /** Rebuild the system prompt (e.g., after SOUL.md changes). */
  refreshSystemPrompt(): void {
    this.config.soulEngine.reload();
    // this.buildSystemPrompt();
    // Update all existing contexts with the new prompt
    // Note: This only refreshes the Main Agent for now, or would need iteration over all agent types
    // Since we don't store agentId in context map keys directly (only in closure/setSystemPrompt),
    // we might miss sub-agents if we don't track who owns which context.
    // For now, let's assume this only forces a refresh for the Main Agent contexts.

    // Simplification: Contexts will lazy-refresh system prompt on next 'run' if we flag them,
    // but here we just manually update known ones with Main Agent prompt?
    // Actually, refreshSystemPrompt is usually called when skills change.
    // We should probably clear contexts or re-evaluate.
    // Let's just re-set for the main agent as a best-effort.
    const mainAgentId = this.config.agentId || 'prometheus';
    const mainPrompt = this.getSystemPrompt(mainAgentId);

    for (const context of this.contexts.values()) {
      // Warning description: blind update. Ideally context should know its agent.
      // Assuming mainly single-user single-agent for now in active contexts.
      context.setSystemPrompt(mainPrompt);
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
