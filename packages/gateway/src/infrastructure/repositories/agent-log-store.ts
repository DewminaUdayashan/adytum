import { singleton } from 'tsyringe';
import { join } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';

export interface AgentLogEntry {
  timestamp: number;
  type: 'think' | 'tool' | 'message' | 'system' | 'thought' | 'action' | 'interaction';
  content: string;
}

@singleton()
export class AgentLogStore {
  private logDir: string;

  constructor(dataPath: string) {
    this.logDir = join(dataPath, 'agent_logs');
    if (!existsSync(this.logDir)) {
      mkdirSync(this.logDir, { recursive: true });
    }
  }

  async append(agentId: string, entry: AgentLogEntry): Promise<void> {
    const logPath = join(this.logDir, `${agentId}.jsonl`);
    const line = JSON.stringify(entry) + '\n';
    // In production, use streams or a real DB. For MVP, fs append is fine.
    // Sync for simplicity in MVP to avoid race conditions on file close,
    // though async appendFile is better.
    // Using appendFileSync for atomic write guarantee per line.
    const { appendFileSync } = await import('fs');
    appendFileSync(logPath, line, 'utf-8');
  }

  async getByAgent(agentId: string, limit = 100): Promise<AgentLogEntry[]> {
    const logPath = join(this.logDir, `${agentId}.jsonl`);
    if (!existsSync(logPath)) return [];

    const content = readFileSync(logPath, 'utf-8');
    const lines = content.trim().split('\n');
    return lines
      .slice(-limit)
      .map((line) => {
        try {
          const raw = JSON.parse(line);
          // Map stored types to domain types
          const type =
            raw.type === 'think'
              ? 'thought'
              : raw.type === 'tool'
                ? 'action'
                : raw.type === 'message'
                  ? 'interaction'
                  : raw.type === 'system'
                    ? 'interaction'
                    : raw.type;
          return { ...raw, type };
        } catch {
          return null;
        }
      })
      .filter((e): e is AgentLogEntry => e !== null);
  }

  async getByAgentAndType(
    agentId: string,
    type: 'thought' | 'action' | 'interaction',
    limit = 100,
  ): Promise<AgentLogEntry[]> {
    // Get more logs to account for filtering, then filter by domain type
    const logs = await this.getByAgent(agentId, limit * 2);
    // Cast type to any to avoid generic overlap check or ensure input types are valid subset
    return logs.filter((l) => l.type === type).slice(-limit);
  }
}
