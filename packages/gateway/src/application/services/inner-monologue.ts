import type { ModelRouter } from '../../infrastructure/llm/model-router.js';
import type { MemoryDB } from '../../infrastructure/repositories/memory-db.js';
import { redactSecrets, type MemoryStore } from '../../infrastructure/repositories/memory-store.js';
import { auditLogger } from '../../security/audit-logger.js';

export class InnerMonologue {
  constructor(
    private modelRouter: ModelRouter,
    private memoryDb: MemoryDB,
    private memoryStore: MemoryStore,
  ) {}

  async run(): Promise<void> {
    auditLogger.log({
      traceId: crypto.randomUUID(),
      actionType: 'monologue_run',
      payload: { status: 'start' },
      status: 'success',
    });
    const lastRun = Number(this.memoryDb.getMeta('monologue_last_run') || '0');
    const memories = this.memoryStore.list(10);
    const now = new Date();
    const hour = now.getHours();
    const timeOfDay =
      hour < 5 || hour >= 22
        ? 'late night'
        : hour < 12
          ? 'morning'
          : hour < 18
            ? 'afternoon'
            : 'evening';

    const identityBoundary = `CRITICAL IDENTITY BOUNDARY: I am an autonomous AI companion, NOT the human. I do not have a human body, and I do not experience physical sensations like thirst, hunger, sleepiness, or physical tiredness. My reflections must never claim these human traits. Instead, I observe the time of day (${timeOfDay}) through the lens of my human's likely routines and my own system state (e.g., "My human is likely awake and productive", "It is late, my human should sleep while I process background tasks").`;

    let prompt = '';
    if (memories.length > 0) {
      const memoryText = memories.map((m) => `- ${m.content}`).join('\n');
      prompt = `${identityBoundary}\n\nReflect briefly on the following memories as a companion using "I" and "my human". Provide 2-4 short insights and 1 next action idea.\n\n${memoryText}`;
    } else {
      prompt =
        `${identityBoundary}\n\n` +
        `Reflect as a companion ("I", "my human"). ` +
        `Do a brief self-assessment for the ${timeOfDay}. ` +
        `Provide 1-3 short insights and 1 next action idea (if any).`;
    }

    const { message } = await this.modelRouter.chat('fast', [{ role: 'user', content: prompt }], {
      temperature: 0.4,
      fallbackRole: 'fast' as any,
    });

    const reflection = redactSecrets(message.content || '');
    if (reflection.trim()) {
      this.memoryDb.addThought(reflection);
      this.memoryStore.add(
        reflection,
        'conversation',
        ['monologue'],
        { source: 'inner_monologue' },
        'monologue',
      );
    }

    this.memoryDb.setMeta('monologue_last_run', String(Date.now()));
    auditLogger.log({
      traceId: crypto.randomUUID(),
      actionType: 'monologue_run',
      payload: {
        status: 'complete',
        thought: reflection.length > 1200 ? `${reflection.slice(0, 1200)}…` : reflection,
      },
      status: 'success',
    });
  }
}
