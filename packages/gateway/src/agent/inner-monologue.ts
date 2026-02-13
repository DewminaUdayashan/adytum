import type { ModelRouter } from './model-router.js';
import type { MemoryDB } from './memory-db.js';
import { redactSecrets, type MemoryStore } from './memory-store.js';
import { auditLogger } from '../security/audit-logger.js';

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
    const timeOfDay = hour < 5 || hour >= 22 ? 'late night' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';

    let prompt = '';
    if (memories.length > 0) {
      const memoryText = memories.map((m) => `- ${m.content}`).join('\n');
      prompt = `Reflect briefly on the following memories in first person. Use "I" and "my human". Provide 2-4 short insights and 1 next action idea (if any).\n\n${memoryText}`;
    } else {
      prompt = `No recent memories are available. Reflect in first person ("I", "my human"). ` +
        `Do a brief self check-in for ${timeOfDay}. If it's late night, suggest waiting. ` +
        `Provide 1-3 short insights and 1 next action idea (if any).`;
    }

    const { message } = await this.modelRouter.chat('fast', [
      { role: 'user', content: prompt },
    ], { temperature: 0.4, fallbackRole: 'fast' as any });

    const reflection = redactSecrets(message.content || '');
    if (reflection.trim()) {
      this.memoryDb.addThought(reflection);
      this.memoryStore.add(reflection, 'conversation', ['monologue'], { source: 'inner_monologue' }, 'monologue');
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
