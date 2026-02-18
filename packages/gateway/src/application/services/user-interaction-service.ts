
import { singleton, inject } from 'tsyringe';
import { GatewayServer } from '../../server.js';
import { LogbookService } from './logbook-service.js';

@singleton()
export class UserInteractionService {
  constructor(
    @inject(GatewayServer) private server: GatewayServer,
    @inject('LogbookService') private logbook: LogbookService,
  ) {}

  /**
   * Asks the user a question and waits for a text response.
   * This bridges the agent to the frontend/CLI via GatewayServer events.
   */
  async askUser(agentId: string, question: string, metadata?: { sessionId?: string; workspaceId?: string }): Promise<string> {
    this.logbook.append({
      timestamp: Date.now(),
      agentId,
      agentName: 'System', 
      tier: 0,
      event: 'user_interaction_request',
      detail: `Question: ${question}`,
    });

    try {
      const answer = await this.server.requestInput(question, metadata);
      
      this.logbook.append({
        timestamp: Date.now(),
        agentId,
        agentName: 'System', 
        tier: 0,
        event: 'user_interaction_response',
        detail: `Answer: ${answer.slice(0, 50)}...`,
      });

      return answer;
    } catch (error: any) {
      return `Failed to get user input: ${error.message}`;
    }
  }
}
