/**
 * @file packages/gateway/src/tools/registry.ts
 * @description Defines tool handlers exposed to the runtime.
 */

import { z } from 'zod';
import type { ToolCall, ToolResult, ToolDefinition } from '@adytum/shared';

// ─── Tool Registry ────────────────────────────────────────────

/**
 * Encapsulates tool registry behavior.
 */
export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  /**
   * Executes register.
   * @param tool - Tool.
   */
  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  /**
   * Executes get.
   * @param name - Name.
   * @returns The get result.
   */
  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /**
   * Executes unregister.
   * @param name - Name.
   */
  unregister(name: string): void {
    this.tools.delete(name);
  }

  /**
   * Executes unregister many.
   * @param names - Names.
   */
  unregisterMany(names: string[]): void {
    for (const name of names) {
      this.tools.delete(name);
    }
  }

  /**
   * Executes has.
   * @param name - Name.
   * @returns True when has.
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Retrieves all.
   * @returns The resulting collection of values.
   */
  getAll(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /**
   * Convert all tools to OpenAI function-calling format.
   */
  toOpenAITools(): Array<{
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  }> {
    return this.getAll().map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: this.zodToJsonSchema(tool.parameters),
      },
    }));
  }

  /**
   * Execute a tool call with validation.
   */
  async execute(call: ToolCall, context?: any): Promise<ToolResult> {
    const tool = this.tools.get(call.name);
    if (!tool) {
      return {
        toolCallId: call.id,
        name: call.name,
        result: `Error: Unknown tool "${call.name}"`,
        isError: true,
      };
    }

    try {
      // Validate arguments
      const validated = tool.parameters.parse(call.arguments);
      const result = await tool.execute(validated, context);

      return {
        toolCallId: call.id,
        name: call.name,
        result,
        isError: false,
      };
    } catch (error: any) {
      return {
        toolCallId: call.id,
        name: call.name,
        result: `Error: ${error.message}`,
        isError: true,
      };
    }
  }

  /**
   * Simple Zod to JSON Schema conversion for OpenAI.
   */
  private zodToJsonSchema(schema: z.ZodObject<any>): Record<string, unknown> {
    const shape = schema.shape;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      const zodType = value as z.ZodTypeAny;
      properties[key] = this.zodTypeToJson(zodType);

      if (!zodType.isOptional()) {
        required.push(key);
      }
    }

    return {
      type: 'object',
      properties,
      required: required.length > 0 ? required : undefined,
    };
  }

  /**
   * Executes zod type to json.
   * @param type - Type.
   * @returns The zod type to json result.
   */
  private zodTypeToJson(type: z.ZodTypeAny): Record<string, unknown> {
    if (type instanceof z.ZodString) return { type: 'string', description: type.description };
    if (type instanceof z.ZodNumber) return { type: 'number', description: type.description };
    if (type instanceof z.ZodBoolean) return { type: 'boolean', description: type.description };
    if (type instanceof z.ZodArray)
      return { type: 'array', items: this.zodTypeToJson(type.element) };
    if (type instanceof z.ZodEnum) return { type: 'string', enum: type.options };
    if (type instanceof z.ZodOptional) return this.zodTypeToJson(type.unwrap());
    if (type instanceof z.ZodDefault) return this.zodTypeToJson(type.removeDefault());
    return { type: 'string' };
  }
}
