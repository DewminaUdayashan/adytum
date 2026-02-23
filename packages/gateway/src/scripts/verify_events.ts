import { logger } from '../logger.js';
import 'reflect-metadata';
import { v4 as uuid } from 'uuid';
import { EventBusService } from '../infrastructure/events/event-bus.js';
import { createEventTools } from '../tools/events.js';

// Mock Dependencies
const mockBus = new EventBusService();

async function verify() {
  logger.debug('🧪 Verifying Even-Driven Architecture...');

  const agentId = 'test-agent';
  const tools = createEventTools(mockBus, agentId);
  const emitTool = tools.find((t) => t.name === 'emit_event')!;
  const waitTool = tools.find((t) => t.name === 'wait_for_event')!;

  logger.debug('1. Testing wait_for_event (async)...');

  // Start waiting
  const waitPromise = waitTool.execute({ type: 'test:ping' });

  // Simulate delay then emit
  setTimeout(async () => {
    logger.debug('   -> Emitting test:ping...');
    await emitTool.execute({
      type: 'test:ping',
      payload: JSON.stringify({ message: 'pong' }),
    });
  }, 1000);

  const result = await waitPromise;

  if (typeof result === 'string' && result.includes('received') && result.includes('pong')) {
    logger.debug('✅ wait_for_event success:', result);
  } else {
    console.error('❌ wait_for_event failed:', result);
  }

  logger.debug('2. Testing timeout...');
  const timeoutResult = await waitTool.execute({ type: 'never:happen', timeoutMs: 500 });

  if (typeof timeoutResult === 'string' && timeoutResult.includes('Timeout')) {
    logger.debug('✅ timeout success:', timeoutResult);
  } else {
    console.error('❌ timeout failed:', timeoutResult);
  }
}

verify().catch(console.error);
