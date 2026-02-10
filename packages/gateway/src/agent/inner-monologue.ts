import type { ModelRouter } from './model-router.js';
import type { MemoryDB } from './memory-db.js';
import type { MemoryStore } from './memory-store.js';

export class InnerMonologue {
  constructor(
    private modelRouter: ModelRouter,
    private memoryDb: MemoryDB,
    private memoryStore: MemoryStore,
  ) {}

  async run(): Promise<void> {
    const lastRun = Number(this.memoryDb.getMeta('monologue_last_run') || '0');
    const memories = this.memoryStore.list(10);

    if (memories.length === 0) {
      this.memoryDb.setMeta('monologue_last_run', String(Date.now()));
      return;
    }

    const memoryText = memories.map((m) => `- ${m.content}`).join('\n');
    const prompt = `Reflect briefly on the following memories. Provide 2-4 short insights.\n\n${memoryText}`;

    const { message } = await this.modelRouter.chat('fast', [
      { role: 'user', content: prompt },
    ], { temperature: 0.4 });

    const reflection = message.content || '';
    if (reflection.trim()) {
      this.memoryDb.addThought(reflection);
      this.memoryStore.add(reflection, 'conversation', ['monologue'], { source: 'inner_monologue' }, 'monologue');
    }

    this.memoryDb.setMeta('monologue_last_run', String(Date.now()));
  }
}
