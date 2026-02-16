/**
 * @file packages/gateway/src/application/services/logbook-service.ts
 * @description Centralized LOGBOOK.md writer for hierarchical multi-agent global progress.
 */

import { appendFileSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const LOGBOOK_FILENAME = 'LOGBOOK.md';

export interface LogbookEntry {
  timestamp: number;
  agentId?: string;
  agentName?: string;
  tier?: number;
  event: string;
  detail?: string;
}

/**
 * Writes and appends to a single LOGBOOK.md in the workspace.
 * Tracks global progress across Prometheus and sub-agents.
 */
export class LogbookService {
  private workspacePath: string;

  constructor(workspacePath: string) {
    this.workspacePath = workspacePath;
  }

  private getPath(): string {
    return join(this.workspacePath, LOGBOOK_FILENAME);
  }

  /**
   * Ensure LOGBOOK exists with a header.
   */
  ensureExists(): void {
    const path = this.getPath();
    if (!existsSync(path)) {
      const header = `# LOGBOOK — Global Progress

| Time (UTC) | Agent | Tier | Event | Detail |
|------------|-------|------|-------|--------|
`;
      writeFileSync(path, header, 'utf-8');
    }
  }

  /**
   * Append a single entry. Thread-safe for single process; use mutex if multi-process.
   */
  append(entry: LogbookEntry): void {
    this.ensureExists();
    const path = this.getPath();
    const iso = new Date(entry.timestamp).toISOString();
    const agent = entry.agentName ?? entry.agentId ?? '—';
    const tier = entry.tier ?? '—';
    const detail = (entry.detail ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
    const line = `| ${iso} | ${agent} | ${tier} | ${entry.event} | ${detail} |\n`;
    appendFileSync(path, line, 'utf-8');
  }

  /**
   * Read full LOGBOOK content for API/dashboard.
   */
  read(): string {
    this.ensureExists();
    return readFileSync(this.getPath(), 'utf-8');
  }
}
