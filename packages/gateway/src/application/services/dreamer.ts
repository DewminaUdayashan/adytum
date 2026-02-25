/**
 * @file packages/gateway/src/application/services/dreamer.ts
 * @description Implements application-level service logic and coordination.
 */

import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ModelRouter } from '../../infrastructure/llm/model-router.js';
import type { MemoryDB } from '../../infrastructure/repositories/memory-db.js';
import { redactSecrets, type MemoryStore } from '../../infrastructure/repositories/memory-store.js';
import { auditLogger } from '../../security/audit-logger.js';

import type { SoulEngine } from '../../domain/logic/soul-engine.js';

/**
 * Encapsulates dreamer behavior.
 */
export class Dreamer {
  constructor(
    private modelRouter: ModelRouter,
    private memoryDb: MemoryDB,
    private memoryStore: MemoryStore,
    private soulEngine: SoulEngine,
    private dataPath: string,
    private workspacePath: string,
  ) {}

  /**
   * Executes run.
   */
  async run(): Promise<void> {
    auditLogger.log({
      traceId: crypto.randomUUID(),
      actionType: 'dreamer_run',
      payload: { status: 'start' },
      status: 'success',
    });

    // 1. Cost Control Check
    // We check total daily cost to prevent runaway dreaming
    const today = new Date().toISOString().split('T')[0];
    const dailyUsage = this.memoryDb.getTokenUsageDaily({ from: new Date().setHours(0, 0, 0, 0) });
    const totalCost = dailyUsage.reduce((acc, row) => acc + row.cost, 0);

    // Hard limit: $2.00 per day for entire system (conservative)
    // Dreamer usually runs at end of day, so if we burned budget, skipping is safer
    if (totalCost > 2.0) {
      auditLogger.log({
        traceId: crypto.randomUUID(),
        actionType: 'dreamer_run',
        payload: { status: 'skip', reason: 'daily_budget_exceeded', cost: totalCost },
        status: 'blocked',
      });
      return;
    }

    const lastRun = Number(this.memoryDb.getMeta('dreamer_last_run') || '0');
    // Fetch logs only since last successful run
    // We increase limit to capture full day if needed, but 'since' filter handles the window
    const logs = this.memoryDb.getActionLogsSince(lastRun).filter((l) => {
      // We only care about user interactions and tool results, not internal model chatter
      if (l.actionType === 'model_call' || l.actionType === 'model_response') return false;
      if (l.actionType === 'error') return false;
      return true;
    });

    const messages = this.memoryDb.getRecentMessages(100);
    // Filter messages to only those after lastRun would be ideal, but getRecentMessages doesn't support 'since'
    // For now, we rely on the overlap being acceptable or we could filter manually:
    const newMessages = messages.filter((m) => m.createdAt > lastRun);

    if (newMessages.length === 0 && logs.length === 0) {
      auditLogger.log({
        traceId: crypto.randomUUID(),
        actionType: 'dreamer_run',
        payload: { status: 'skip', reason: 'no_new_activity' },
        status: 'success',
      });
      this.memoryDb.setMeta('dreamer_last_run', String(Date.now()));
      return;
    }

    const convo = newMessages.map((m) => `${m.role}: ${m.content}`).join('\n');
    const logText = logs
      .map(
        (l) =>
          `${new Date(l.createdAt).toISOString()} ${l.actionType}: ${JSON.stringify(l.payload)}`,
      )
      .join('\n');

    const safeConvo = redactSecrets(convo);
    const safeLogText = redactSecrets(logText);

    // 2. Structured Extraction Prompt
    const prompt = `
You are the "Memory system" for an AI agent. 
Analyze the following new conversation and activity logs.
Extract key **Facts**, **User Preferences**, and **Project Context** that should be remembered for the future.

Input Data:
Conversation:
${safeConvo}

Activity Logs:
${safeLogText}

Instructions:
1. Ignore transient errors, hello/goodbye pleasantries, and system noise.
2. Focus on:
   - User tech stack choices (e.g., "User uses Next.js")
   - Project constraints (e.g., "The API is at port 3000")
   - User communication preferences (e.g., "User likes concise answers")
   - Completed major milestones.
3. Output strictly a JSON object with this shape:
   {
     "memories": [
       { "content": "Fact string", "category": "preference" | "fact" | "milestone", "tags": ["tag1", "tag2"] }
     ]
   }
4. If nothing worth remembering, return { "memories": [] }
`;

    const { message } = await this.modelRouter.chat('fast', [{ role: 'user', content: prompt }], {
      temperature: 0.1,
      response_format: { type: 'json_object' }, // Enforce JSON if supported, else prompt does it
      fallbackRole: 'fast' as any,
    });

    let extracted: { memories: Array<{ content: string; category: string; tags: string[] }> } = {
      memories: [],
    };

    try {
      if (message.content) {
        let content = message.content.trim();
        // Remove markdown code blocks if present
        if (content.startsWith('```')) {
          const match = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
          if (match && match[1]) {
            content = match[1].trim();
          }
        }
        extracted = JSON.parse(content);
      }
    } catch (e) {
      console.warn('[Dreamer] Failed to parse structured memory JSON', e);
      console.debug(`Content that failed to parse: ${message.content}`);
    }

    // 3. Store Memories
    if (extracted.memories && extracted.memories.length > 0) {
      await this.memoryStore.addBatch(
        extracted.memories.map((m) => ({
          content: m.content,
          category: m.category as any,
          tags: m.tags,
          source: 'dreamer',
          metadata: { confidence: 1.0, extractedAt: Date.now() },
        })),
      );
    }

    // 4. Evolve Soul (Legacy support - keep updating EVOLUTION.md for debugging)
    const summary = extracted.memories.map((m) => `- ${m.content}`).join('\n');
    if (summary) {
      const evolutionPath = join(this.workspacePath, 'EVOLUTION.md');
      if (existsSync(evolutionPath)) {
        appendFileSync(evolutionPath, `\n## ${new Date().toISOString()}\n${summary}\n`, 'utf-8');
      } else {
        writeFileSync(
          evolutionPath,
          `# Evolution of Soul\n\n## ${new Date().toISOString()}\n${summary}\n`,
          'utf-8',
        );
      }
    }

    this.memoryDb.setMeta('dreamer_last_run', String(Date.now()));

    auditLogger.log({
      traceId: crypto.randomUUID(),
      actionType: 'dreamer_run',
      payload: {
        status: 'complete',
        memoriesExtracted: extracted.memories.length,
      },
      status: 'success',
    });
  }

  /**
   * Executes evolve soul.
   * @param summary - Summary.
   */
  private async evolveSoul(summary: string): Promise<void> {
    // Check if auto-update is enabled (defaulting to true for v0.2.0)
    // We can't easily access global config here without passing it, but we can rely on
    // proper injection eventually. For now, we'll assume enabled or check env.
    // Better: Dreamer should receive the config or a flag in constructor.
    // For this step, I will assume it is enabled or controlled via a simple check.

    const currentSoul = this.soulEngine.getSoulPrompt();

    const evolutionPrompt = `
You are the subconscious mind of the AI Agent "Adytum".
Your goal is to evolve the agent's "Soul" (personality, ethics, and long-term directives) based on recent experiences.

Current Soul (SOUL.md):
${currentSoul}

Recent Experiences & Insights (Dream Summary):
${summary}

Instructions:
1. Analyze if the recent experiences suggest a need to update the Soul.
   - Did the user express a strong preference?
   - Did the agent learn a new fundamental constraint or behavior?
   - Is the current personality seemingly misaligned with the user's communication style?
2. If NO updates are needed, reply with exactly "NO_UPDATE".
3. If updates ARE needed, output the FULL, UPDATED content of SOUL.md.
   - Maintain the "companion" persona and "my human" terminology.
   - **IMPORTANT**: Ensure the agent's identity is clearly defined as an AI companion. Do not allow the soul to drift into possessing human biology or physical needs.
   - Maintain the existing structure.
   - Be subtle and additive. Do not rewrite everything, just refine.
   - Ensure the "Identity" and "Born on" dates remain (or are preserved).
`;

    try {
      const { message } = await this.modelRouter.chat(
        'thinking',
        [{ role: 'user', content: evolutionPrompt }],
        { temperature: 0.4, fallbackRole: 'thinking' as any },
      );

      const response = message.content?.trim();
      if (!response || response === 'NO_UPDATE') {
        return;
      }

      // Sanity check: ensure it looks like markdown and contains "Identity" or similar
      if (!response.includes('# ') || !response.includes('## Identity')) {
        console.warn('[Dreamer] Soul evolution response malformed. Skipping.');
        return;
      }

      // Update Soul
      this.soulEngine.updateSoul(response);

      auditLogger.log({
        traceId: crypto.randomUUID(),
        actionType: 'soul_evolve',
        payload: { status: 'updated' },
        status: 'success',
      });
    } catch (error) {
      console.error('[Dreamer] Soul evolution failed:', error);
    }
  }
}
