/**
 * @file packages/gateway/src/application/services/agent-service.ts
 * @description Implements application-level service logic and coordination.
 */

import { singleton, inject } from 'tsyringe';
import { Logger } from '../../logger.js';
import { ConfigService } from '../../infrastructure/config/config-service.js';
import { AgentRuntime } from '../../domain/logic/agent-runtime.js';
import { MemoryDB } from '../../infrastructure/repositories/memory-db.js';
import { ModelCatalog } from '../../infrastructure/llm/model-catalog.js';
import { SkillLoader } from '../services/skill-loader.js';
import { ToolRegistry } from '../../tools/registry.js';
import { tokenTracker, TokenTracker } from '../../domain/logic/token-tracker.js';
import { ModelRouter } from '../../infrastructure/llm/model-router.js';
import { SoulEngine } from '../../domain/logic/soul-engine.js';
import type { ModelRepository } from '../../domain/interfaces/model-repository.interface.js';

/**
 * Encapsulates agent service behavior.
 */
@singleton()
export class AgentService {
  constructor(
    @inject(Logger) private logger: Logger,
    @inject(ConfigService) private configService: ConfigService,
    @inject(AgentRuntime) private runtime: AgentRuntime
  ) {}

  /**
   * Retrieves runtime.
   * @returns The get runtime result.
   */
  public getRuntime(): AgentRuntime {
    return this.runtime;
  }

  // Application implementation methods (delegates to runtime)
  /**
   * Executes process message.
   * @param sessionId - Session id.
   * @param content - Content.
   * @returns The process message result.
   */
  public async processMessage(sessionId: string, content: string): Promise<any> {
    const runtime = this.getRuntime();
    // runtime.handleMessage... logic involves context manager & reasoning loop
    // For now we might expose the runtime or wrap specific methods
    return runtime; 
  }
}
