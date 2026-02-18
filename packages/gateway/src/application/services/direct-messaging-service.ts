
import { singleton, inject } from 'tsyringe';
import { AgentRegistry } from '../../domain/agents/agent-registry.js';
import { RuntimeRegistry } from '../../domain/agents/runtime-registry.js';
import { LogbookService } from './logbook-service.js';

export interface MessageResult {
  success: boolean;
  response?: string;
  error?: string;
}

@singleton()
export class DirectMessagingService {
  constructor(
    @inject('AgentRegistry') private agentRegistry: AgentRegistry,
    @inject(RuntimeRegistry) private runtimeRegistry: RuntimeRegistry,
    @inject('LogbookService') private logbook: LogbookService,
  ) {}

  /**
   * Sends a direct message from one agent to another.
   * If the recipient is active, it triggers an immediate response (turn).
   */
  async sendMessage(
    senderId: string,
    recipientNameOrId: string,
    content: string,
  ): Promise<MessageResult> {
    // 1. Identify Recipient
    let recipient = this.agentRegistry.get(recipientNameOrId); // Check by ID
    if (!recipient) {
      // Alias 'Adytum' to 'Prometheus' (or whatever the Tier 1 agent is)
      if (recipientNameOrId.toLowerCase() === 'adytum') {
        recipientNameOrId = 'Prometheus';
      }
      const record = this.agentRegistry.findActiveByName(recipientNameOrId); // Check by Name
      if (record) recipient = this.agentRegistry.get(record.id);
    }

    if (!recipient) {
      return { success: false, error: `Recipient "${recipientNameOrId}" not found or inactive.` };
    }

    // 2. Resolve Active Session
    // We access the internal record to get activeSessionId (which might not be on AgentMetadata interface yet?)
    // AgentRegistry.get returns AgentMetadata.
    // I need to check AgentMetadata interface in @adytum/shared or locally.
    // In agent-registry.ts, AgentRecord has activeSessionId. toMetadata() does NOT include it by default?
    // Let's check agent-registry.ts again.
    // Line 190: `return { ... activeSessionId? }`
    // I need to ensure I can get the session ID.
    // For now, I'll cheat and access the private map if I was inside registry, but I am in a service.
    // I should add `getActiveSessionId(agentId)` to AgentRegistry.
    
    // WAIT. DirectMessagingService is in `application/services`. AgentRegistry is in `domain/agents`.
    // I should modify AgentRegistry to expose `getActiveSessionId`.
    
    // For this write, I'll assume I can add that method to AgentRegistry next.
    const sessionId = this.agentRegistry.getActiveSessionId(recipient.id);

    if (!sessionId) {
       return { success: false, error: `Recipient "${recipient.name}" has no active session.` };
    }

    // 3. Get Runtime
    const runtime = this.runtimeRegistry.getRuntime(sessionId); 

    if (!runtime) {
      return { success: false, error: `Recipient "${recipient.name}" is not currently running (Session ${sessionId} not found in registry).` };
    }

    // 4. Execute Turn
    const sender = this.agentRegistry.get(senderId);
    const senderName = sender ? sender.name : 'Unknown Agent';
    const formattedMessage = `[Incoming Message from ${senderName} (ID: ${senderId})]: ${content}`;

    try {
      this.logbook.append({
        timestamp: Date.now(),
        agentId: senderId,
        agentName: senderName,
        tier: sender ? sender.tier : 0,
        event: 'message_sent',
        detail: `To: ${recipient.name}. Content: ${content.slice(0, 50)}...`,
      });

      const result = await runtime.run(formattedMessage, sessionId);
      
      this.logbook.append({
        timestamp: Date.now(),
        agentId: recipient.id,
        agentName: recipient.name,
        tier: recipient.tier,
        event: 'message_received',
        detail: `From: ${senderName}. Response: ${result.response.slice(0, 50)}...`,
      });

      return { success: true, response: result.response };
    } catch (err: any) {
      return { success: false, error: `Message delivery failed: ${err.message}` };
    }
  }
}
