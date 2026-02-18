
import 'reflect-metadata';
import { container } from 'tsyringe';
import { v4 as uuid } from 'uuid';
import { DirectMessagingService } from '../application/services/direct-messaging-service.js';
import { UserInteractionService } from '../application/services/user-interaction-service.js';
import { AgentRegistry } from '../domain/agents/agent-registry.js';
import { RuntimeRegistry } from '../domain/agents/runtime-registry.js';
import { LogbookService } from '../application/services/logbook-service.js';

// Mock Dependencies
const mockLogbook = {
  append: (entry: any) => console.log(`[Logbook] ${entry.event}: ${entry.detail}`),
};

const mockServer = {
  requestInput: async (desc: string) => {
    console.log(`[Server] Input requested: ${desc}`);
    return "User Answer";
  },
};

const mockAgentRuntime = {
  run: async (input: string) => ({
    response: `Echo: ${input}`,
    trace: { id: 'trace-1' },
    toolCalls: [],
  }),
};

async function verify() {
  console.log('🧪 Verifying Communication Services...');

  // Setup Registry Mocks
  const agentRegistry = {
    get: (id: string) => ({ id, name: 'Recipient', tier: 1 }),
    findActiveByName: () => ({ id: 'recipient-id', name: 'Recipient' }),
    getActiveSessionId: () => 'session-1',
  } as any;

  const runtimeRegistry = {
    getRuntime: (sessionId: string) => (sessionId === 'session-1' ? mockAgentRuntime : undefined),
  } as any;

  // 1. Test DirectMessagingService
  const messagingService = new DirectMessagingService(
    agentRegistry,
    runtimeRegistry,
    mockLogbook as any
  );

  console.log('Testing sendMessage...');
  const result = await messagingService.sendMessage('sender-id', 'Recipient', 'Hello World');
  
  if (result.success && result.response?.includes('Echo')) {
    console.log('✅ sendMessage success:', result.response);
  } else {
    console.error('❌ sendMessage failed:', result);
  }

  // 2. Test UserInteractionService
  const interactionService = new UserInteractionService(
    mockServer as any,
    mockLogbook as any
  );

  console.log('Testing askUser...');
  const answer = await interactionService.askUser('agent-id', 'How are you?');
  
  if (answer === 'User Answer') {
    console.log('✅ askUser success:', answer);
  } else {
    console.error('❌ askUser failed:', answer);
  }
}

verify().catch(console.error);
