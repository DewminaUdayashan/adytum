import 'reflect-metadata';
import { v4 as uuid } from 'uuid';
import { EventBusService } from '../infrastructure/events/event-bus.js';
import { createEventTools } from '../tools/events.js';

// Mock Dependencies
const mockBus = new EventBusService();

async function verify() {
  console.log('🧪 Verifying Even-Driven Architecture...');

  const agentId = 'test-agent';
  const tools = createEventTools(mockBus, agentId);
  const emitTool = tools.find((t) => t.name === 'emit_event')!;
  const waitTool = tools.find((t) => t.name === 'wait_for_event')!;

  console.log('1. Testing wait_for_event (async)...');

  // Start waiting
  const waitPromise = waitTool.execute({ type: 'test:ping' });

  // Simulate delay then emit
  setTimeout(async () => {
    console.log('   -> Emitting test:ping...');
    await emitTool.execute({
      type: 'test:ping',
      payload: JSON.stringify({ message: 'pong' }),
    });
  }, 1000);

  const result = await waitPromise;

  if (typeof result === 'string' && result.includes('received') && result.includes('pong')) {
    console.log('✅ wait_for_event success:', result);
  } else {
    console.error('❌ wait_for_event failed:', result);
  }

  console.log('2. Testing timeout...');
  const timeoutResult = await waitTool.execute({ type: 'never:happen', timeoutMs: 500 });

  if (typeof timeoutResult === 'string' && timeoutResult.includes('Timeout')) {
    console.log('✅ timeout success:', timeoutResult);
  } else {
    console.error('❌ timeout failed:', timeoutResult);
  }
}

verify().catch(console.error);
