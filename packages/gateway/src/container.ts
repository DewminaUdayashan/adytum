/**
 * @file packages/gateway/src/container.ts
 * @description Defines module behavior for the Adytum workspace.
 */

import 'reflect-metadata';
import { container } from 'tsyringe';
import { Logger } from './logger.js';
import { ConfigService } from './infrastructure/config/config-service.js';
import { SqliteMemoryRepository } from './infrastructure/repositories/sqlite-memory-repository.js';
import { ModelCatalog } from './infrastructure/llm/model-catalog.js';
import { AgentService } from './application/services/agent-service.js';
import { SkillService } from './application/services/skill-service.js';
import { ModelService } from './application/services/model-service.js';
import { ApprovalService } from './domain/logic/approval-service.js';

import { AgentController } from './api/controllers/agent.controller.js';
import { ConfigController } from './api/controllers/config.controller.js';
import { HealthController } from './api/controllers/health.controller.js';
import { ModelController } from './api/controllers/model.controller.js';
import { SkillController } from './api/controllers/skill.controller.js';
import { SystemController } from './api/controllers/system.controller.js';
import { TaskController } from './api/controllers/task.controller.js';

/**
 * Executes setup container.
 */
export function setupContainer() {
  // Register singletons
  container.register(Logger, { useValue: new Logger() });
  container.register(ConfigService, { useClass: ConfigService });

  // Repositories
  container.register('MemoryRepository', { useClass: SqliteMemoryRepository });

  // Register ModelCatalog as a singleton first
  container.registerSingleton(ModelCatalog);
  // Then alias the interface token to the class token so they resolve to the SAME instance
  container.register('ModelRepository', { useToken: ModelCatalog });

  // Services
  // Services
  container.registerSingleton(AgentService);
  container.registerSingleton(SkillService);
  container.registerSingleton(ModelService);
  container.registerSingleton(ApprovalService);

  // Controllers
  container.registerSingleton(AgentController);
  container.register(ConfigController, { useClass: ConfigController });
  container.register(HealthController, { useClass: HealthController });
  container.register(ModelController, { useClass: ModelController });
  container.register(SkillController, { useClass: SkillController });
  container.register(SystemController, { useClass: SystemController });
  container.register(TaskController, { useClass: TaskController });

  return container;
}

export { container };
