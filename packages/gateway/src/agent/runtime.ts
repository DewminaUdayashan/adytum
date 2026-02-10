import { v4 as uuid } from 'uuid';
import type OpenAI from 'openai';
import type { ModelRole, ToolCall, Trace } from '@adytum/shared';
import { ContextManager } from './context-manager.js';
import { ModelRouter } from './model-router.js';
import { SoulEngine } from './soul-engine.js';
import { SkillLoader } from './skill-loader.js';
import { ToolRegistry } from '../tools/registry.js';
import { tokenTracker } from './token-tracker.js';
import { auditLogger } from '../security/audit-logger.js';
import { EventEmitter } from 'node:events';

export interface AgentRuntimeConfig {
  modelRouter: ModelRouter;
  toolRegistry: ToolRegistry;
  soulEngine: SoulEngine;
  skillLoader: SkillLoader;
  contextSoftLimit: number;
  maxIterations: number;
  defaultModelRole: ModelRole;
  agentName: string;
  onApprovalRequired?: (description: string) => Promise<boolean>;
}

export interface AgentTurnResult {
  response: string;
  trace: Trace;
  toolCalls: ToolCall[];
}

/**
 * The ReAct Agent Runtime.
 *
 * Loop:
 *   1. Build context (system prompt + SOUL.md + skills + conversation + tool results)
 *   2. Call LLM via model-router (emit stream events for live console)
 *   3. Parse response for tool calls
 *   4. If tool calls → execute tools → loop
 *   5. If no tool calls → return final response
 *   6. Check token budget → compact if over soft threshold
 */
export class AgentRuntime extends EventEmitter {
  private config: AgentRuntimeConfig;
  private context: ContextManager;

  constructor(config: AgentRuntimeConfig) {
    super();
    this.config = config;
    this.context = new ContextManager(config.contextSoftLimit);
    this.buildSystemPrompt();
  }

  /** Run a full agent turn (user message → response). */
  async run(userMessage: string, sessionId: string): Promise<AgentTurnResult> {
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
    this.context.addMessage({ role: 'user', content: userMessage });

    const allToolCalls: ToolCall[] = [];
    let finalResponse = '';
    let iterations = 0;

    try {
      while (iterations < this.config.maxIterations) {
        iterations++;

        // Check for compaction
        if (this.context.needsCompaction()) {
          await this.compactContext(traceId, sessionId);
        }

        // Call the model
        auditLogger.logModelCall(traceId, this.config.defaultModelRole, this.context.getMessageCount());

        this.emit('stream', {
          traceId,
          sessionId,
          streamType: 'status',
          delta: `Thinking... (iteration ${iterations})`,
        });

        const { message, usage } = await this.config.modelRouter.chat(
          this.config.defaultModelRole,
          this.context.getMessages(),
          {
            tools: this.config.toolRegistry.toOpenAITools(),
            temperature: 0.7,
          },
        );

        // Track tokens
        tokenTracker.record(usage, sessionId);
        auditLogger.logModelResponse(traceId, usage.model, usage);

        // Check for tool calls
        if (message.tool_calls && message.tool_calls.length > 0) {
          // Add assistant message with tool calls to context
          // Ensure content is never null (some providers like Google Gemini reject it)
          const sanitizedMessage = {
            ...message,
            content: message.content || '',
          };
          this.context.addMessage(sanitizedMessage as OpenAI.ChatCompletionMessageParam);

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

            // Check if tool requires approval
            const toolDef = this.config.toolRegistry.get(toolCall.name);
            if (toolDef?.requiresApproval && this.config.onApprovalRequired) {
              const approved = await this.config.onApprovalRequired(
                `Tool "${toolCall.name}" wants to execute: ${JSON.stringify(toolCall.arguments)}`,
              );
              if (!approved) {
                this.context.addMessage({
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

            this.emit('stream', {
              traceId,
              sessionId,
              streamType: 'tool_result',
              delta: `Tool ${toolCall.name}: ${result.isError ? 'ERROR' : 'OK'}`,
              metadata: { result: result.result },
            });

            // Add tool result to context
            this.context.addMessage({
              role: 'tool',
              tool_call_id: tc.id,
              content: typeof result.result === 'string'
                ? result.result
                : JSON.stringify(result.result),
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
        this.context.addMessage({ role: 'assistant', content: finalResponse });
        break;
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

      this.context.addMessage({ role: 'assistant', content: finalResponse });
    }

    this.emit('trace_end', trace);

    return {
      response: finalResponse,
      trace,
      toolCalls: allToolCalls,
    };
  }

  private async compactContext(traceId: string, sessionId: string): Promise<void> {
    this.emit('stream', {
      traceId,
      sessionId,
      streamType: 'status',
      delta: 'Context limit approaching — compacting memory...',
    });

    const compactionPrompt = this.context.buildCompactionPrompt();

    // Use 'fast' model for compaction
    const { message, usage } = await this.config.modelRouter.chat(
      'fast',
      [{ role: 'user', content: compactionPrompt }],
      { temperature: 0.3 },
    );

    tokenTracker.record(usage, sessionId);

    if (message.content) {
      this.context.applyCompaction(message.content);
    }
  }

  private buildSystemPrompt(): void {
    const soul = this.config.soulEngine.getSoulPrompt();
    const skills = this.config.skillLoader.getSkillsContext();

    const systemPrompt = `${soul}

## Tools
You have access to the following tools. Use them when needed to accomplish the user's goals.
Always explain what you're doing before calling a tool.

${skills}

## Behavior
- Think step by step before acting
- Explain your reasoning transparently
- Ask clarifying questions when requirements are ambiguous
- If a task requires multiple steps, plan before executing
- Log your internal reasoning for the live console
- Never perform destructive actions without user approval
`;

    this.context.setSystemPrompt(systemPrompt);
  }

  /** Rebuild the system prompt (e.g., after SOUL.md changes). */
  refreshSystemPrompt(): void {
    this.config.soulEngine.reload();
    this.config.skillLoader.discover();
    this.buildSystemPrompt();
  }

  /** Clear conversation history. */
  resetContext(): void {
    this.context.clear();
    this.buildSystemPrompt();
  }
}
