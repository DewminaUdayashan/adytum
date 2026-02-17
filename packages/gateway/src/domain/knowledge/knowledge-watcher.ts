import { watch, existsSync, statSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';
import { singleton, inject } from 'tsyringe';
import { GraphIndexer } from './graph-indexer.js';
import { logger } from '../../logger.js';

@singleton()
export class KnowledgeWatcher {
  private watcher: any = null;

  constructor(
    @inject(GraphIndexer) private indexer: GraphIndexer,
    private workspacePath: string,
  ) {}

  start(): void {
    if (this.watcher) return;

    logger.info(`Starting KnowledgeWatcher on ${this.workspacePath}`);

    // Simple recursive watch using node:fs
    // Note: Recursive is supported on macOS and Windows, which matches USER's OS (mac).
    try {
      this.watcher = watch(this.workspacePath, { recursive: true }, (event, filename) => {
        if (!filename) return;
        const ext = extname(filename).toLowerCase();
        const supported = ['.md', '.ts', '.js', '.tsx', '.jsx', '.py', '.dart', '.txt', '.json'];
        if (!supported.includes(ext)) return;

        // Debounce and trigger re-index
        this.handleFileChange(filename);
      });
    } catch (err) {
      logger.error({ err }, 'Failed to start KnowledgeWatcher');
    }
  }

  private debounceTimers = new Map<string, NodeJS.Timeout>();

  private handleFileChange(filename: string): void {
    const fullPath = resolve(this.workspacePath, filename);

    // Ignore common output/dependency directories to prevent infinite loops (e.g. graph updates in /data)
    if (
      filename.includes('node_modules') ||
      filename.includes('dist') ||
      filename.includes('data') ||
      filename.startsWith('.')
    ) {
      return;
    }

    if (this.debounceTimers.has(filename)) {
      clearTimeout(this.debounceTimers.get(filename)!);
    }

    const timer = setTimeout(async () => {
      try {
        logger.debug(`Re-indexing changed file: ${filename}`);
        // We call update() on the indexer.
        // In a more optimized version we could add a method to index a single file.
        // For now, indexer.update() handles incremental logic via hashing.
        // CRITICAL: Ensure we skip LLM summaries to avoid costs during auto-indexing.
        await this.indexer.update(undefined, undefined, { mode: 'fast', skipLLM: true });
      } catch (err) {
        logger.error({ err, filename }, 'Failed to re-index file');
      } finally {
        this.debounceTimers.delete(filename);
      }
    }, 1000); // 1s debounce

    this.debounceTimers.set(filename, timer);
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }
}
