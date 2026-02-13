/**
 * LLM Client — Direct API support for multiple providers.
 *
 * Supports:
 *   - Anthropic (Claude) — native Messages API
 *   - OpenAI — via openai SDK
 *   - OpenRouter, Groq, Together AI — OpenAI-compatible
 *   - Ollama, LM Studio — local OpenAI-compatible
 *   - Any custom OpenAI-compatible endpoint
 *
 * When LiteLLM proxy is running, routes everything through it.
 * Otherwise, calls providers directly using env-based API keys.
 */

import type OpenAI from 'openai';
import type { ModelConfig } from '@adytum/shared';
import { type ModelCatalog } from './model-catalog.js';


// ─── Types ────────────────────────────────────────────────────

export interface LLMChatOptions {
  messages: OpenAI.ChatCompletionMessageParam[];
  tools?: OpenAI.ChatCompletionTool[];
  temperature?: number;
  maxTokens?: number;
}

export interface LLMChatResult {
  message: OpenAI.ChatCompletionMessage;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model: string;
  finishReason?: string;
}


export class LLMClient {
  private catalog: ModelCatalog;

  constructor(catalog: ModelCatalog) {
    this.catalog = catalog;
  }



  /**
   * Send a chat completion request using pi-ai.
   */
  async chat(
    modelConfig: ModelConfig,
    options: LLMChatOptions,
  ): Promise<LLMChatResult> {
    const start = Date.now();
    
    // 1. Resolve model object compatible with pi-ai
    const provider = modelConfig.provider.toLowerCase();
    const modelId = `${provider}/${modelConfig.model}`;
    
    // Try to get cached pi-ai model
    let piModel = this.catalog.getPiModel(modelId);

    // If not found (e.g. custom model or user-defined override not in cache), construct it
    if (!piModel) {
        // Sanitize Base URL
        let baseUrl = modelConfig.baseUrl;
        if (baseUrl) {
             // Strip trailing /chat/completions or /v1 if they are standard suffixes
             // pi-ai usually expects the root API url or v1 root
             // For OpenAI compatible: it appends /chat/completions
             baseUrl = baseUrl.replace(/\/chat\/completions\/?$/, '');
             // We keep /v1 usually
        }

        piModel = {
            id: modelConfig.model,
            provider: provider,
            api: provider === 'anthropic' ? 'anthropic-messages' : 'openai-chat', // Assume openai-chat for custom
            baseUrl: baseUrl,
            name: modelConfig.model, 
        };
        
        // Special case for Google if user manually specified 'google' but not in catalog (unlikely but possible)
        if (provider === 'google') {
            piModel.api = 'google-generative-ai';
        }
    } else {
        // Override baseUrl if user config has one (unlikely for built-ins but good for custom)
        if (modelConfig.baseUrl) {
            piModel = { ...piModel, baseUrl: modelConfig.baseUrl };
        }
    }

    // 2. Prepare API Key
    const apiKey = modelConfig.apiKey || 
                   process.env[`${provider.toUpperCase()}_API_KEY`] || 
                   '';

    // 3. Prepare options
    const piOptions: any = {
        apiKey,
        maxTokens: options.maxTokens,
        temperature: options.temperature,
    };
    
    // Tools mapping
    // pi-ai supports tools but expects its own format or standard OAI?
    // pi.complete supports 'tools' in options?
    // Looking at pi-ai source/docs (inferred):
    // It accepts tools in options.
    // 4. Call pi.complete
    const pi = await import('@mariozechner/pi-ai');

    // Tools mapping: pi-ai expects Tool[] in context
    const piTools = options.tools?.map(t => ({
        name: t.function.name,
        description: t.function.description || '',
        parameters: t.function.parameters as any
    }));

    // Convert messages slightly if needed? pi.complete takes standard {role, content}
    // We sanitize nulls just in case
    
    // Extract system prompt
    const systemMessage = options.messages.find(m => m.role === 'system');
    const systemPrompt = systemMessage ? (systemMessage.content as string) : undefined;
    
    // Filter out system messages and map the rest
    const contextMessages = options.messages
        .filter(m => m.role !== 'system')
        .map(m => {
            const timestamp = Date.now();
            
            if (m.role === 'user') {
                return {
                    role: 'user',
                    content: m.content || '',
                    timestamp
                };
            }
            
            if (m.role === 'assistant') {
                const content: any[] = [];
                if (m.content) {
                    content.push({ type: 'text', text: m.content });
                }
                if (m.tool_calls) {
                    m.tool_calls.forEach(tc => {
                        content.push({
                           type: 'toolCall',
                           id: tc.id,
                           name: tc.function.name,
                           arguments: JSON.parse(tc.function.arguments)
                        });
                    });
                }
                
                return {
                    role: 'assistant',
                    content,
                    timestamp,
                    // Mock required fields for pi-ai AssistantMessage
                    api: piModel.api || 'unknown',
                    provider: piModel.provider || 'unknown',
                    model: piModel.id || 'unknown',
                    usage: { input:0, output:0, cacheRead:0, cacheWrite:0, totalTokens:0, cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},
                    stopReason: 'stop'
                };
            }

            if (m.role === 'tool') {
                return {
                    role: 'toolResult',
                    toolCallId: m.tool_call_id,
                    toolName: 'unknown', // OpenAI doesn't store tool name in tool result
                    content: [{ type: 'text', text: m.content as string }],
                    isError: false,
                    timestamp
                };
            }
            
            // Fallback for other roles (function, developer) -> treat as user? or skip?
            // pi-ai only supports user, assistant, toolResult.
            // Developer role is new OpenAI thing, treat as system if possible or user.
            // But we already extracted system.
            return null; 
        })
        .filter(Boolean) as any[]; // Cast to any to satisfy Message[] for now

    try {
        // Fix: complete takes (model, context, options)
        const result = await pi.complete(piModel, { 
            messages: contextMessages,
            systemPrompt,
            tools: piTools
        }, piOptions);
        
        if (result.errorMessage) {
            throw new Error(result.errorMessage);
        }

        // Map result to LLMChatResult (OpenAI style)
        const choice: OpenAI.ChatCompletionMessage = {
            role: 'assistant',
            content: typeof result.content === 'string' ? result.content : '', // pi-ai might returns block array
            refusal: null, 
        };
        
        // Handle content blocks if array
        if (Array.isArray(result.content)) {
             // pi-ai content blocks: { type: 'text', text: '...' } or { type: 'tool_use', ... }
             // We need to join text and enable tool calls
             const text = result.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('');
             choice.content = text;
             
             const toolCalls = result.content.filter((c: any) => c.type === 'toolCall').map((c: any) => ({
                 id: c.id,
                 type: 'function' as const,
                 function: {
                     name: c.name,
                     arguments: typeof c.arguments === 'string' ? c.arguments : JSON.stringify(c.arguments)
                 }
             }));
             
             if (toolCalls.length > 0) {
                 choice.tool_calls = toolCalls;
             }
        }

        return {
            message: choice,
            usage: {
                promptTokens: result.usage?.input || 0,
                completionTokens: result.usage?.output || 0,
                totalTokens: result.usage?.totalTokens || 0
            },
            model: result.model || modelConfig.model,
            finishReason: result.stopReason
        };

    } catch (e: any) {
        // Enhance error message
        throw new Error(`LLM Error (${provider}/${modelConfig.model}): ${e.message || e}`);
    }
  }

  // Helper methods removed (chatAnthropic, chatOpenAICompatible, etc)
}

// ─── Proxy Detection ──────────────────────────────────────────

/**
 * Check if the LiteLLM proxy is reachable.
 */
export async function isLiteLLMAvailable(proxyUrl: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${proxyUrl}/health`, { signal: controller.signal });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}
