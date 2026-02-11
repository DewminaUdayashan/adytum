import { mkdirSync, writeFileSync, appendFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { auditLogger } from '../security/audit-logger.js';
import type { ModelRouter } from './model-router.js';
import type { MemoryDB } from './memory-db.js';
import { redactSecrets, type MemoryStore } from './memory-store.js';

export class Dreamer {
  constructor(
    private modelRouter: ModelRouter,
    private memoryDb: MemoryDB,
    private memoryStore: MemoryStore,
    private dataPath: string,
    private workspacePath: string,
  ) {}

  async run(): Promise<void> {
    auditLogger.log({
      traceId: crypto.randomUUID(),
      actionType: 'dreamer_run',
      payload: { status: 'start' },
      status: 'success',
    });
    const lastRun = Number(this.memoryDb.getMeta('dreamer_last_run') || '0');
    const messages = this.memoryDb.getRecentMessages(120);
    const logs = this.memoryDb.getActionLogsSince(lastRun);

    if (messages.length === 0 && logs.length === 0) {
      auditLogger.log({
        traceId: crypto.randomUUID(),
        actionType: 'dreamer_run',
        payload: { status: 'skip', reason: 'no_messages_or_logs' },
        status: 'success',
      });
      this.memoryDb.setMeta('dreamer_last_run', String(Date.now()));
      return;
    }

    const convo = messages.map((m) => `${m.role}: ${m.content}`).join('\n');
    const logText = logs.map((l) => `${new Date(l.createdAt).toISOString()} ${l.actionType}: ${JSON.stringify(l.payload)}`).join('\n');

    const safeConvo = redactSecrets(convo);
    const safeLogText = redactSecrets(logText);

    const prompt = `Summarize the following recent conversation and actions into concise bullet points.\n` +
      `Extract concrete facts, preferences, and decisions. Output bullets only.\n\n` +
      `Conversation:\n${safeConvo}\n\nActions:\n${safeLogText}`;

    const { message } = await this.modelRouter.chat('fast', [
      { role: 'user', content: prompt },
    ], { temperature: 0.2 });

    const summary = redactSecrets(message.content || '');
    if (!summary.trim()) {
      auditLogger.log({
        traceId: crypto.randomUUID(),
        actionType: 'dreamer_run',
        payload: { status: 'skip', reason: 'empty_summary' },
        status: 'success',
      });
      this.memoryDb.setMeta('dreamer_last_run', String(Date.now()));
      return;
    }

    const scrubFile = (path: string) => {
      if (!existsSync(path)) return;
      const raw = readFileSync(path, 'utf-8');
      const cleaned = redactSecrets(raw);
      if (cleaned !== raw) writeFileSync(path, cleaned, 'utf-8');
    };

    // Persist snapshot
    const snapshotDir = join(this.dataPath, 'memories', 'snapshots');
    mkdirSync(snapshotDir, { recursive: true });
    const date = new Date().toISOString().split('T')[0];
    const snapshotPath = join(snapshotDir, `${date}.md`);
    scrubFile(snapshotPath);
    appendFileSync(snapshotPath, `\n## ${new Date().toISOString()}\n${summary}\n`, 'utf-8');

    // Store bullet facts into memory store
    const bullets = summary.split('\n').map((l) => l.replace(/^[-*]\s*/, '').trim()).filter(Boolean);
    for (const b of bullets) {
      this.memoryStore.add(b, 'conversation', ['dreamer'], { source: 'dreamer' }, 'dream');
    }

    // Append evolution log
    const evolutionPath = join(this.workspacePath, 'EVOLUTION.md');
    scrubFile(evolutionPath);
    appendFileSync(evolutionPath, `\n## ${new Date().toISOString()}\n${summary}\n`, 'utf-8');

    this.memoryDb.setMeta('dreamer_last_run', String(Date.now()));
    auditLogger.log({
      traceId: crypto.randomUUID(),
      actionType: 'dreamer_run',
      payload: {
        status: 'complete',
        bullets: bullets.length,
        summary: summary.length > 1200 ? `${summary.slice(0, 1200)}…` : summary,
      },
      status: 'success',
    });
  }
}
