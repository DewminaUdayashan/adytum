import { singleton, inject } from 'tsyringe';
import { v4 as uuid } from 'uuid';
import { SwarmMessage, SwarmEvents } from '@adytum/shared';
import { EventBusService } from '../../infrastructure/events/event-bus.js';

@singleton()
export class SwarmMessenger {
  private mailboxes: Map<string, SwarmMessage[]> = new Map();

  constructor(@inject(EventBusService) private eventBus: EventBusService) {}

  /**
   * Sends a message from one agent to another.
   */
  public send(
    fromAgentId: string,
    toAgentId: string,
    content: string,
    type: SwarmMessage['type'] = 'chat',
  ): SwarmMessage {
    const message: SwarmMessage = {
      id: uuid(),
      fromAgentId,
      toAgentId,
      type,
      content,
      timestamp: Date.now(),
    };

    this.deliver(message);
    return message;
  }

  /**
   * Broadcasts a message to all active agents (handled by looping through known IDs or special logic).
   * For now, we support explicit 'BROADCAST' recipient.
   */
  public broadcast(
    fromAgentId: string,
    content: string,
    type: SwarmMessage['type'] = 'alert',
  ): SwarmMessage {
    const message: SwarmMessage = {
      id: uuid(),
      fromAgentId,
      toAgentId: 'BROADCAST',
      type,
      content,
      timestamp: Date.now(),
    };

    // Broadcasts are not stored in individual mailboxes usually,
    // unless we iterate all known agents.
    // For V1, we just emit the event so everyone online "hears" it via the bus/socket.
    this.emitEvent(message);
    return message;
  }

  /**
   * Internal delivery logic.
   */
  private deliver(message: SwarmMessage): void {
    if (message.toAgentId === 'BROADCAST') {
      this.emitEvent(message);
      return;
    }

    if (!this.mailboxes.has(message.toAgentId)) {
      this.mailboxes.set(message.toAgentId, []);
    }
    this.mailboxes.get(message.toAgentId)?.push(message);

    this.emitEvent(message);
  }

  /**
   * Retrieves pending messages for an agent and clears them from the mailbox.
   */
  public getMessages(agentId: string): SwarmMessage[] {
    const messages = this.mailboxes.get(agentId) || [];
    if (messages.length > 0) {
      this.mailboxes.set(agentId, []); // Clear inbox after reading
    }
    return messages;
  }

  /**
   * Peeks at pending messages without clearing.
   */
  public peekMessages(agentId: string): SwarmMessage[] {
    return this.mailboxes.get(agentId) || [];
  }

  private emitEvent(message: SwarmMessage): void {
    this.eventBus.publish(SwarmEvents.AGENT_MESSAGE, message, 'SwarmMessenger');
  }
}
