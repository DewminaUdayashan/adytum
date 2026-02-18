/**
 * @file packages/gateway/src/tools/events.ts
 * @description Tools for event-driven architecture (Phase 2).
 */

import { z } from 'zod';
import type { ToolDefinition } from '@adytum/shared';
import type { EventBusService } from '../infrastructure/events/event-bus.js';

export function createEventTools(eventBus: EventBusService, sourceAgentId: string): ToolDefinition[] {
  return [
    {
      name: 'emit_event',
      description:
        'Emits a system-wide event. Use this to notify other agents or system components about a state change, a completed task, or a trigger condition.',
      parameters: z.object({
        type: z.string().describe('The event type (e.g., "build:failed", "test:completed"). Use namespaced keys.'),
        payload: z.string().describe('JSON stringified payload containing event details.'),
      }),
      execute: async (args: unknown) => {
        const { type, payload } = args as { type: string; payload: string };
        try {
          const parsed = JSON.parse(payload);
          eventBus.publish(type as any, parsed, sourceAgentId);
          return `Event "${type}" emitted successfully.`;
        } catch (err: any) {
          return `Failed to emit event: ${err.message}`;
        }
      },
    },
    {
      name: 'wait_for_event',
      description:
        'Pauses execution until a specific event type is received or timeout occurs. Use this to synchronize with other agents.',
      parameters: z.object({
        type: z.string().describe('The event type to wait for.'),
        timeoutMs: z.number().optional().describe('Timeout in milliseconds (default: 60000).'),
      }),
      execute: async (args: unknown) => {
        const { type, timeoutMs = 60000 } = args as { type: string; timeoutMs?: number };
        
        return new Promise((resolve) => {
          let timer: NodeJS.Timeout;

          const handler = (event: any) => {
            clearTimeout(timer);
            resolve(`Event "${type}" received: ${JSON.stringify(event.payload)}`);
          };

          timer = setTimeout(() => {
            eventBus.off(type, handler);
            resolve(`Timeout waiting for event "${type}" after ${timeoutMs}ms.`);
          }, timeoutMs);

          // We use 'once' via the underlying EventEmitter logic, BUT EventBusService.subscribe wraps 'on'.
          // EventBusService extends EventEmitter, so we can use .once() directly if public.
          // EventBusService definition: export class EventBusService extends EventEmitter
          // So yes, .once() is available.
          eventBus.once(type, handler);
        });
      },
    },
  ];
}
