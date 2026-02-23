import { logger } from '../../logger.js';
/**
 * @file packages/gateway/src/infrastructure/events/event-bus.ts
 * @description Central event bus service for Adytum.
 */

import { EventEmitter } from 'events';
import { singleton } from 'tsyringe';
import { AdytumEvent, EventType } from '@adytum/shared';
import { v4 as uuidv4 } from 'uuid';

/**
 * Encapsulates event bus behavior.
 */
@singleton()
export class EventBusService extends EventEmitter {
  constructor() {
    super();
    // Increase limit for multiple subscribers
    this.setMaxListeners(50);
  }

  /**
   * Publishes an event to all subscribers.
   */
  publish<T>(type: EventType, payload: T, source: string, correlationId?: string): void {
    const event: AdytumEvent<T> = {
      id: uuidv4(),
      type,
      payload,
      source,
      timestamp: Date.now(),
      correlationId,
    };

    // Emit specific event type
    this.emit(type, event);

    // Emit wildcard for global listeners (debuggers, websocket bridge)
    this.emit('*', event);

    // Simple robust logging (avoid circular JSON errors with complex payloads)
    try {
      // Only log high-level info unless debug mode
      // logger.debug(`[EventBus] ${type} from ${source}`);
    } catch {
      // ignore logging errors
    }
  }

  /**
   * Subscribes to a specific event type.
   */
  subscribe<T>(type: EventType, handler: (event: AdytumEvent<T>) => void): void {
    this.on(type, handler);
  }

  /**
   * Subscribes to all events (wildcard).
   */
  subscribeAll(handler: (event: AdytumEvent) => void): void {
    this.on('*', handler);
  }
}
