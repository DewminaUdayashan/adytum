import 'reflect-metadata';
import { container } from 'tsyringe';
import { MemoryDB } from '../src/infrastructure/repositories/memory-db.js';
import { EmbeddingService } from '../src/infrastructure/llm/embedding-service.js';
import { loadConfig } from '../src/config.js';
import { resolve } from 'path';

async function main() {
  const projectRoot = process.cwd();
  const config = loadConfig(projectRoot);

  console.log(`[Backfill] Database path: ${config.dataPath}`);

  const memoryDb = new MemoryDB(config.dataPath);
  const embeddingService = new EmbeddingService();

  // 1. Fetch all memories
  // We need a way to list ALL, not just recent.
  // extending MemoryDB locally for this script or just using what we have.
  // listMemories has a limit. Let's set a high limit.
  const allMemories = memoryDb.listMemories(10000);

  console.log(`[Backfill] Found ${allMemories.length} memories.`);

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const mem of allMemories) {
    if (mem.embedding) {
      skipped++;
      continue;
    }

    try {
      console.log(`[Backfill] Embedding memory ${mem.id}...`);
      const vector = await embeddingService.embed(mem.content);
      const buffer = Buffer.from(vector.buffer);

      // Direct DB update since MemoryDB doesn't expose update method yet
      // We will add a raw update method to MemoryDB or just run raw query here if possible.
      // MemoryDB exposes `db` as private.
      // We might need to add an `updateEmbedding` method to MemoryDB first.
      // Or we can use the `db` property if we cast to any, but better to add the method.

      // Actually, let's assume we added `updateMemoryEmbedding` to MemoryDB.
      // I'll update MemoryDB in the next step to support this.
      // For now, I'll use raw SQL via a public method if available, or just cast to any.

      (memoryDb as any).db
        .prepare('UPDATE memories SET embedding = ? WHERE id = ?')
        .run(buffer, mem.id);
      updated++;
    } catch (err) {
      console.error(`[Backfill] Failed to embed ${mem.id}:`, err);
      failed++;
    }
  }

  console.log(`[Backfill] Complete. Updated: ${updated}, Skipped: ${skipped}, Failed: ${failed}`);
}

main().catch(console.error);
