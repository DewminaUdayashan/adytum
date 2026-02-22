/**
 * @file packages/gateway/src/index.ts
 * @description Defines module behavior for the Adytum workspace.
 */

import 'reflect-metadata';
import { v4 as uuid } from 'uuid';
import chalk from 'chalk';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { watch, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadConfig } from './config.js';
import { logger } from './logger.js';
import { GatewayServer } from './server.js';
import { AgentRuntime, AgentRuntimeConfig } from './domain/logic/agent-runtime.js';
import { SwarmManager } from './domain/logic/swarm-manager.js';
import { SwarmMessenger } from './domain/logic/swarm-messenger.js';
import { DispatchService } from './application/services/dispatch-service.js';
import { createSwarmTools } from './tools/swarm-tools.js';
import { ModelRouter } from './infrastructure/llm/model-router.js';
import { ModelCatalog } from './infrastructure/llm/model-catalog.js';
import { SwarmSweeper } from './domain/logic/swarm-sweeper.js';
import { Compactor } from './domain/logic/compactor.js';

import { setupContainer, container } from './container.js';
import { SoulEngine } from './domain/logic/soul-engine.js';
import { SemanticProcessor } from './domain/knowledge/semantic-processor.js';
import { SkillLoader } from './application/services/skill-loader.js';
import { ToolRegistry } from './tools/registry.js';
import { createShellTool, createShellToolWithApproval } from './tools/shell.js';
import { createFileSystemTools } from './tools/filesystem.js';
import { createWebFetchTool } from './tools/web-fetch.js';
import { createMemoryTools } from './tools/memory.js';
import { createPersonalityTools } from './tools/personality.js';
import { PermissionManager } from './security/permission-manager.js';
import { SecretsStore } from './security/secrets-store.js';
import { tokenTracker } from './domain/logic/token-tracker.js';
import { autoProvisionStorage } from './storage/provision.js';
import { MemoryStore } from './infrastructure/repositories/memory-store.js';
import { MemoryDB } from './infrastructure/repositories/memory-db.js';
import { EmbeddingService } from './infrastructure/llm/embedding-service.js';
import { Dreamer } from './application/services/dreamer.js';
import { InnerMonologue } from './application/services/inner-monologue.js';
import { HeartbeatManager } from './application/services/heartbeat-manager.js';
import { CronManager } from './application/services/cron-manager.js';
import { createCronTools } from './tools/cron.js';
import { createTextTools } from './tools/text-tools.js';
import cron from 'node-cron';
import { AgentService } from './application/services/agent-service.js';
import { SkillService } from './application/services/skill-service.js';
import { ApprovalService } from './domain/logic/approval-service.js';
import { GraphStore } from './domain/knowledge/graph-store.js';
import { GraphIndexer } from './domain/knowledge/graph-indexer.js';
import { GraphContext } from './domain/knowledge/graph-context.js';
import { GraphTraversalService } from './domain/knowledge/graph-traversal.js';
import { KnowledgeWatcher } from './domain/knowledge/knowledge-watcher.js';
import { createKnowledgeTools } from './tools/knowledge.js';
import { AgentRegistry } from './domain/agents/agent-registry.js';
import { LogbookService } from './application/services/logbook-service.js';
import { AgentLogStore } from './infrastructure/repositories/agent-log-store.js';
import { AgentsController } from './api/controllers/agents.controller.js';
// import { SubAgentSpawner } from './domain/logic/sub-agent-spawner.js';
// import { createSpawnAgentTool } from './tools/spawn-agent.js';
import { RuntimeRegistry } from './domain/agents/runtime-registry.js';
import { TaskPlanner } from './domain/logic/task-planner.js';
import { ParallelExecutor } from './domain/logic/parallel-executor.js';
// import { createDelegationTools } from './tools/delegate-task.js';
import { randomUUID } from 'crypto';
import { createPlannerTools } from './tools/planner.js';
import { ToolErrorHandler } from './domain/logic/tool-error-handler.js';
import { EventBusService } from './infrastructure/events/event-bus.js';
import { SocketIOService } from './infrastructure/events/socket-io-service.js';
import { DirectMessagingService } from './application/services/direct-messaging-service.js';
import { createCommunicationTools } from './tools/communication-tools.js';
import { UserInteractionService } from './application/services/user-interaction-service.js';
import { createInteractionTools } from './tools/interaction.js';
import { createEventTools } from './tools/events.js';

const defaultProjectRoot = resolve(fileURLToPath(import.meta.url), '../../..');

export const startGateway = async (rootPath?: string) => {
  const projectRoot = rootPath || defaultProjectRoot;
  const config = loadConfig(projectRoot);

  // Initialize DI Container
  setupContainer();

  console.log(chalk.dim(`\n  Starting ${config.agentName}...\n`));

  // ── Event Bus (Phase 2.1) ─────────────────────────────────
  const eventBus = new EventBusService();
  container.register(EventBusService, { useValue: eventBus });

  const socketIOService = new SocketIOService(eventBus);
  container.register(SocketIOService, { useValue: socketIOService });

  // ── Storage Auto-Provisioning ─────────────────────────────
  const dbResult = await autoProvisionStorage(config);
  console.log(chalk.green('  ✓ ') + chalk.white(`Storage: ${dbResult.type}`));

  const secretsStore = new SecretsStore(config.dataPath);
  const memoryDb = new MemoryDB(config.dataPath);
  container.register('MemoryDB', { useValue: memoryDb });

  // Vector Embeddings Support
  const embeddingService = container.resolve(EmbeddingService);

  const memoryStore = new MemoryStore(memoryDb, embeddingService);
  memoryStore.setEventBus(eventBus);
  container.register(MemoryStore, { useValue: memoryStore });
  const graphStore = new GraphStore(config.dataPath);
  container.register(GraphStore, { useValue: graphStore });

  // ── Security Layer ────────────────────────────────────────
  const permissionManager = new PermissionManager(
    config.workspacePath,
    config.dataPath,
    graphStore,
  );
  permissionManager.startWatching();
  container.register(PermissionManager, { useValue: permissionManager });

  // ── Tool Registry ─────────────────────────────────────────
  const toolRegistry = new ToolRegistry();
  container.register(ToolRegistry, { useValue: toolRegistry });

  // ─── Native Tools ──────────────────────────────────────────
  for (const fsTool of createFileSystemTools(permissionManager)) {
    toolRegistry.register(fsTool);
  }

  // Shell tool with approval logic (re-wired later if needed, but set up here)
  const shellTool = createShellTool(async (command, context) => {
    // Note: 'server' will be defined later, so we use a wrapper that references it
    return await (global as any).adytumServer.requestApproval({
      kind: 'shell_execute',
      description: `Execute: ${command}`,
      meta: { command },
      sessionId: context?.sessionId,
      workspaceId: context?.workspaceId,
    });
  }, permissionManager.resolveWorkspacePath.bind(permissionManager));
  toolRegistry.register(shellTool);

  for (const mTool of createMemoryTools(memoryStore)) {
    toolRegistry.register(mTool);
  }

  toolRegistry.register(createWebFetchTool());

  for (const pTool of createPersonalityTools(memoryDb)) {
    toolRegistry.register(pTool);
  }

  // ─── Knowledge Graph Tools (Phase 1.2) ─────────────────────
  const traversalService = new GraphTraversalService(graphStore);
  container.register(GraphTraversalService, { useValue: traversalService });

  // ─── Agent Runtime ─────────────────────────────────────────
  const modelCatalog = container.resolve(ModelCatalog);
  const modelRouter = new ModelRouter({
    litellmBaseUrl: `http://localhost:${config.litellmPort}/v1`,
    models: config.models,
    modelChains: config.modelChains,
    taskOverrides: config.taskOverrides,
    modelCatalog,
    routing: config.routing,
  });
  container.register(ModelRouter, { useValue: modelRouter });

  const semanticProcessor = new SemanticProcessor(modelRouter, memoryStore);
  container.register(SemanticProcessor, { useValue: semanticProcessor });
  const graphIndexer = new GraphIndexer(config.workspacePath, graphStore, semanticProcessor);
  container.register(GraphIndexer, { useValue: graphIndexer });
  graphIndexer.setEventBus(eventBus);
  const graphContext = new GraphContext(graphStore, memoryStore);
  container.register(GraphContext, { useValue: graphContext });

  for (const kTool of createKnowledgeTools(traversalService, graphIndexer, memoryStore)) {
    toolRegistry.register(kTool);
  }

  // ─── Error Recovery (Phase 2.2) ────────────────────────────
  const toolErrorHandler = new ToolErrorHandler();
  container.register(ToolErrorHandler, { useValue: toolErrorHandler });

  // ─── Task Planner (Phase 2.1) ──────────────────────────────
  const taskPlanner = new TaskPlanner(modelRouter);
  const parallelExecutor = new ParallelExecutor(toolRegistry, toolErrorHandler);

  for (const tool of createPlannerTools(taskPlanner, parallelExecutor)) {
    toolRegistry.register(tool);
  }

  // ─── Semantic Search (Phase 2.3) ───────────────────────────

  const { createSemanticTools } = await import('./tools/semantic-search.js');
  for (const tool of createSemanticTools(memoryStore)) {
    toolRegistry.register(tool);
  }

  const runtimeRegistry = new RuntimeRegistry();
  container.register(RuntimeRegistry, { useValue: runtimeRegistry });
  // Detect LiteLLM vs direct API mode
  const llmStatus = await modelRouter.initialize();
  console.log(chalk.green('  ✓ ') + chalk.white(`LLM: ${llmStatus}`));

  // Initialize provider infrastructure (env detection, discovery, auth, selection, fallback)
  await modelCatalog.initProviders();
  const allModels = await modelCatalog.getAll();
  console.log(chalk.green('  ✓ ') + chalk.white(`Providers: ${allModels.length} models loaded`));

  const soulEngine = new SoulEngine(config.workspacePath);
  container.register(SoulEngine, { useValue: soulEngine });
  const skillLoader = new SkillLoader(config.workspacePath, {
    projectRoot,
    dataPath: config.dataPath,
    config,
  });
  container.register(SkillLoader, { useValue: skillLoader });
  skillLoader.setSecrets(secretsStore.getAll());
  await skillLoader.init(toolRegistry);

  const dispatchService = new DispatchService(skillLoader, toolRegistry);
  container.register(DispatchService, { useValue: dispatchService });
  dispatchService.refresh();

  /*
   * KnowledgeWatcher is now a Sensor and integrated via SensorManager in GatewayServer generally.
   * However, index.ts (CLI entry point) instantiates it manually for the standalone runtime loop.
   * We need to update this to inject EventBusService.
   */
  const knowledgeWatcher = new KnowledgeWatcher(graphIndexer, eventBus, config.workspacePath);
  // knowledgeWatcher.start(); // Covered by SensorManager in GatewayServer usually, but here maybe standalone?
  // Actually, index.ts starts GatewayServer later.
  // If GatewayServer owns SensorManager and starts all sensors, we shouldn't start it here manually
  // UNLESS we want it running even before gateway starts (which is fine).
  // But wait, GatewayServer creates its OWN SensorManager via DI.
  // Code in server.ts: this.sensorManager.register(container.resolve(SystemHealthSensor));
  // It doesn't register KnowledgeWatcher yet.

  // Let's register this instance with the container so GatewayServer picks it up?
  // Or just let GatewayServer resolve a new one?
  // KnowledgeWatcher is @singleton.
  // If we resolve it here, the container holds it.

  // Let's just update the constructor for now to fix the build.
  await knowledgeWatcher.start();

  // ─── Swarm & Hierarchy (Moved Up) ─────────────────────────
  const swarmMessenger = new SwarmMessenger(eventBus);
  container.register(SwarmMessenger, { useValue: swarmMessenger });

  const agentRegistry = new AgentRegistry(config.dataPath);
  container.register('AgentRegistry', { useValue: agentRegistry });

  const agentLogStore = new AgentLogStore(config.dataPath);
  container.register('AgentLogStore', { useValue: agentLogStore });

  const logbookService = new LogbookService(config.workspacePath);
  container.register('LogbookService', { useValue: logbookService });

  // Ensure Prometheus (Tier 1) exists for ID resolution
  const prometheusAvatarUrl = 'https://api.dicebear.com/9.x/bottts/svg?seed=Prometheus';
  const existingPrometheus = agentRegistry.findAgent({ name: config.agentName, tier: 1 });

  if (!existingPrometheus) {
    const rootId = (config as any).agentId || 'prometheus';
    agentRegistry.register({
      id: rootId,
      name: config.agentName,
      tier: 1,
      mission: 'Master Orchestrator',
      parentId: null,
      status: 'idle',
      modelId: 'default',
      avatar: prometheusAvatarUrl,
      mode: 'reactive',
      cronSchedule: undefined,
      topics: [],
      persistence: 'persistent',
      createdAt: Date.now(),
    });
    logbookService.append({
      timestamp: Date.now(),
      event: 'birth',
      detail: 'Prometheus (Tier 1) initialized in AgentRegistry',
    });
  }
  const prometheusAgentId = existingPrometheus
    ? existingPrometheus.id
    : (config as any).agentId || 'prometheus';

  // Update config for SwarmManager to pick up correct ID
  (config as any).agentId = prometheusAgentId;

  const swarmManager = new SwarmManager(config, eventBus, swarmMessenger, agentRegistry);
  container.register(SwarmManager, { useValue: swarmManager });

  const swarmSweeper = new SwarmSweeper(swarmManager, logger);
  container.register(SwarmSweeper, { useValue: swarmSweeper });
  swarmSweeper.start();

  const agentRuntimeConfig: AgentRuntimeConfig = {
    modelRouter,
    toolRegistry,
    soulEngine,
    swarmManager,
    swarmMessenger,
    skillLoader,
    dispatchService,
    graphContext,
    contextSoftLimit: config.contextSoftLimit,
    compactor: container.resolve(Compactor),
    modelCatalog,
    maxIterations: 20,
    defaultModelRole: 'thinking' as const,
    agentName: config.agentName,
    agentId: prometheusAgentId, // [UPDATED]
    workspacePath: config.workspacePath,
    memoryStore,
    memoryTopK: 3,
    memoryDb,
    graphStore,
    runtimeRegistry,
    toolErrorHandler,
    onApprovalRequired: async (description, context) => {
      // @ts-expect-error - global.adytumServer is dynamically assigned
      if (!global.adytumServer) return false;
      // @ts-expect-error - global.adytumServer is dynamically assigned
      return global.adytumServer.requestApproval({
        kind: 'tool',
        description,
        sessionId: context?.sessionId,
        workspaceId: context?.workspaceId,
      });
    },
  };

  const agent = new AgentRuntime(agentRuntimeConfig);

  // Seed context with recent persisted messages to restore short-term memory
  const recentMessages = memoryDb
    .getRecentMessages(120)
    .filter((m) => {
      const session = (m.sessionId || '').toLowerCase();
      return !session.startsWith('system-') && !session.startsWith('cron-');
    })
    .slice(-40);
  agent.seedContext(recentMessages.map((m) => ({ role: m.role as any, content: m.content })));
  await skillLoader.start(agent);

  /**
   * Executes reload skills.
   */
  const reloadSkills = async (): Promise<void> => {
    const latestConfig = loadConfig(projectRoot);
    skillLoader.updateConfig(latestConfig, projectRoot);
    skillLoader.setSecrets(secretsStore.getAll());
    await skillLoader.reload(agent);
    dispatchService.refresh();
    agent.refreshSystemPrompt();
  };

  // Auto-reload skills when files change under workspace/skills
  const skillsPath = resolve(config.workspacePath, 'skills');
  /**
   * Starts skills watcher.
   */
  const startSkillsWatcher = () => {
    if (!existsSync(skillsPath)) return;
    let timer: NodeJS.Timeout | null = null;
    /**
     * Executes debounce reload.
     */
    const debounceReload = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        try {
          logger.info('Skills change detected, reloading...');
          await reloadSkills();
        } catch (err: any) {
          logger.error({ err }, 'Skills reload failed');
        }
      }, 400);
    };

    watch(skillsPath, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      debounceReload();
    });
  };
  startSkillsWatcher();

  // One-time migration: move known skill env vars into secrets store, then reload if changed.
  /**
   * Executes migrate skill envs.
   */
  const migrateSkillEnvs = async () => {
    let changed = false;
    for (const skill of skillLoader.getAll()) {
      const meta = skill.manifest?.metadata;
      const required = [...(meta?.requires?.env || []), meta?.primaryEnv].filter((v): v is string =>
        Boolean(v),
      );
      for (const envName of required) {
        if (process.env[envName] && !secretsStore.getAll()[skill.id]?.[envName]) {
          secretsStore.setSkillSecret(skill.id, envName, process.env[envName] as string);
          changed = true;
        }
      }
    }
    if (changed) {
      skillLoader.setSecrets(secretsStore.getAll());
      await skillLoader.reload(agent);
    }
  };
  await migrateSkillEnvs();

  // ── Dreamer & Inner Monologue (Phase 3/4) ─────────────────
  const dreamer = new Dreamer(
    modelRouter,
    memoryDb,
    memoryStore,
    soulEngine,
    config.dataPath,
    config.workspacePath,
  );
  const monologue = new InnerMonologue(modelRouter, memoryDb, memoryStore);
  const heartbeatManager = new HeartbeatManager(agent, config.workspacePath);

  // Managed cron tasks for dreamer and monologue (restartable)
  let dreamerTask: cron.ScheduledTask | null = null;
  let monologueTask: cron.ScheduledTask | null = null;

  /**
   * Executes schedule dreamer.
   * @param minutes - Minutes.
   */
  function scheduleDreamer(minutes: number) {
    dreamerTask?.stop();
    const safe = Math.max(1, Math.floor(minutes));
    const expr = safe < 60 ? `*/${safe} * * * *` : `0 */${Math.floor(safe / 60)} * * *`;
    logger.info({ interval: safe, expression: expr }, 'Dreamer scheduled');
    dreamerTask = cron.schedule(expr, async () => {
      try {
        await dreamer.run();
      } catch (err) {
        logger.error({ err }, 'Dreamer task failed');
      }
    });
  }

  /**
   * Executes schedule monologue.
   * @param minutes - Minutes.
   */
  function scheduleMonologue(minutes: number) {
    monologueTask?.stop();
    const safe = Math.max(1, Math.floor(minutes));
    const expr = safe < 60 ? `*/${safe} * * * *` : `0 */${Math.floor(safe / 60)} * * *`;
    logger.info({ interval: safe, expression: expr }, 'Monologue scheduled');
    monologueTask = cron.schedule(expr, async () => {
      try {
        await monologue.run();
      } catch (err) {
        logger.error({ err }, 'Monologue task failed');
      }
    });
  }

  scheduleDreamer(config.dreamerIntervalMinutes);
  scheduleMonologue(config.monologueIntervalMinutes);

  // LogbookService moved up
  const cronManager = new CronManager(agent, config.dataPath, runtimeRegistry, logbookService);
  swarmManager.setCronManager(cronManager);

  // Register Cron Tools (needs agent instance)
  for (const tool of createCronTools(cronManager)) {
    toolRegistry.register(tool);
  }
  for (const tool of createTextTools(modelRouter)) {
    toolRegistry.register(tool);
  }
  console.log(
    chalk.green('  ✓ ') + chalk.white(`Tools: ${toolRegistry.getAll().length} registered`),
  );
  agent.refreshSystemPrompt();

  // Start Heartbeat Scheduler
  heartbeatManager.start(config.heartbeatIntervalMinutes);

  console.log(chalk.green('  ✓ ') + chalk.white(`Agent: ${config.agentName} loaded`));

  // ── Dependency Injection Wiring ───────────────────────────
  // Register the live instances we just created into the container
  // so that Controllers can resolve them.

  container.register(AgentRuntime, { useValue: agent });
  container.register(ModelRouter, { useValue: modelRouter });
  container.register('RuntimeConfig', { useValue: config });
  container.register('RouterConfig', { useValue: config });
  container.register(SkillLoader, { useValue: skillLoader });
  container.register(CronManager, { useValue: cronManager });
  container.register(ModelCatalog, { useValue: modelCatalog });
  container.register(SoulEngine, { useValue: soulEngine });
  container.register(ToolRegistry, { useValue: toolRegistry });
  container.register('MemoryDB', { useValue: memoryDb });
  container.register('MemoryRepository', { useValue: memoryDb });
  container.register(PermissionManager, { useValue: permissionManager });
  container.register(SecretsStore, { useValue: secretsStore });
  container.register(GraphStore, { useValue: graphStore });
  container.register(GraphIndexer, { useValue: graphIndexer });
  container.register(GraphContext, { useValue: graphContext });
  container.register(KnowledgeWatcher, { useValue: knowledgeWatcher });

  // ── Hierarchical Multi-Agent (Phase 4) ────────────────────────
  // AgentRegistry & AgentLogStore moved up

  // ─── Messaging Service (Phase 1.1) ────────────────────────
  const messagingService = new DirectMessagingService(
    agentRegistry,
    runtimeRegistry,
    logbookService,
  );
  container.register(DirectMessagingService, { useValue: messagingService });

  // ─── Interaction Service (Phase 1.1) ──────────────────────
  const interactionService = new UserInteractionService(
    {
      requestInput: async (...args: any[]) => {
        // @ts-expect-error - global.adytumServer is dynamically assigned
        if (!global.adytumServer) throw new Error('GatewayServer not yet initialized');
        // @ts-expect-error - global.adytumServer is dynamically assigned
        return global.adytumServer.requestInput(...args);
      },
    } as any,
    logbookService,
  );
  container.register(UserInteractionService, { useValue: interactionService });

  // SwarmManager, AgentRegistry, RuntimeConfig moved up

  // Register Communication Tools for Root Agent
  const commTools = createCommunicationTools(swarmMessenger, swarmManager);
  commTools.forEach((t) => toolRegistry.register(t));

  // Register Interaction Tools for Root Agent
  const interactTools = createInteractionTools(
    interactionService,
    prometheusAgentId,
    { workspaceId: config.workspacePath },
    'reactive', // Root agent is always reactive
  );
  interactTools.forEach((t) => toolRegistry.register(t));

  // Register Event Tools for Root Agent (Phase 2)
  const eventTools = createEventTools(eventBus, prometheusAgentId);
  eventTools.forEach((t) => toolRegistry.register(t));

  agent.refreshSystemPrompt();

  // Emergency stop: log critical model failure to LOGBOOK
  modelRouter.on('critical_failure', (payload: { roleOrTask: string; errors: string[] }) => {
    logbookService.append({
      timestamp: Date.now(),
      event: 'critical_failure',
      detail: `All models failed for "${payload.roleOrTask}". Errors: ${payload.errors.slice(0, 3).join('; ')}`,
    });
    logger.warn(
      { roleOrTask: payload.roleOrTask, errors: payload.errors },
      'Critical task failure — pipeline emergency stop',
    );
  });

  // Wire up SkillService reload callback
  const skillService = container.resolve(SkillService);
  skillService.setReloadCallback(reloadSkills);

  // ── Gateway Server ────────────────────────────────────────
  const server = new GatewayServer({
    port: config.gatewayPort,
    host: '0.0.0.0', // Listen on all interfaces so dashboard proxy (localhost or 127.0.0.1) can connect; avoids EADDRNOTAVAIL on macOS.
    permissionManager,
    workspacePath: config.workspacePath,
    heartbeatManager,
    cronManager,
    skillLoader,
    toolRegistry,
    memoryDb,
    secretsStore,
    onScheduleUpdate: (type, intervalMinutes) => {
      if (type === 'dreamer') scheduleDreamer(intervalMinutes);
      else if (type === 'monologue') scheduleMonologue(intervalMinutes);
    },
    onSkillsReload: reloadSkills,
    onChainsUpdate: (chains) => {
      modelRouter.updateChains(chains);
    },
    onRoutingUpdate: (routing) => {
      modelRouter.updateRouting(routing);
    },
    modelCatalog,
    modelRouter,
    socketIOService,
    agentsController: container.resolve(AgentsController), // Inject controller
  });

  (global as any).adytumServer = server;

  // Route WebSocket messages to agent
  server.on('frame', async ({ sessionId, frame }) => {
    if (frame.type === 'message') {
      const result = await agent.run(frame.content, sessionId, {
        modelRole: frame.modelRole,
        modelId: frame.modelId,
        workspaceId: frame.workspaceId,
      });
      server.sendToSession(sessionId, {
        type: 'message',
        sessionId,
        content: result.response,
      });
    }
  });

  // Stream agent events to WebSocket clients
  agent.on('stream', (event) => {
    server.broadcast({
      type: 'stream',
      ...event,
    });
  });

  // Register Swarm Tools (Phase 4)
  const swarmTools = createSwarmTools(swarmManager, agent);
  swarmTools.forEach((t) => toolRegistry.register(t));

  await server.start();
  console.log(chalk.green('  ✓ ') + chalk.white(`Gateway: http://localhost:${config.gatewayPort}`));

  // ── Restore Persistent Daemons (Phase 4.1) ────────────────
  // await subAgentSpawner.restoreDaemons();

  console.log(chalk.dim('\n  ─────────────────────────────────────'));
  console.log(chalk.cyan(`  ${config.agentName} is awake. Type your message below.`));
  console.log(chalk.dim(`  Type "exit" to stop. Type "/clear" to reset context.`));
  console.log(chalk.dim('  ─────────────────────────────────────\n'));

  // ── Terminal REPL ─────────────────────────────────────────
  const sessionId = uuid();
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.blue(`  ${config.agentName} > `),
    terminal: true,
  });

  // Graceful shutdown on Ctrl+C
  /**
   * Executes shutdown.
   */
  let isShuttingDown = false;
  /**
   * Executes shutdown.
   */
  const shutdown = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.log(chalk.dim(`\n  ${config.agentName} is resting. Goodbye.\n`));

    // Stop interactive loop
    rl.close();

    try {
      permissionManager.stopWatching();
      await knowledgeWatcher.stop();
      await skillLoader.stop();
      const sweeper = container.resolve(SwarmSweeper);
      sweeper.stop();
      await server.stop();
      logger.info('Shutdown complete.');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdown());
  process.on('SIGTERM', () => shutdown());

  // Shared approval prompt that pauses/resumes the main REPL
  // to prevent double character echo
  /**
   * Executes prompt approval.
   * @param promptText - Prompt text.
   * @returns Whether the operation succeeded.
   */
  const promptApproval = async (promptText: string): Promise<boolean> => {
    rl.pause();
    // Remove the main readline from stdin so it doesn't intercept keys
    process.stdin.setRawMode?.(false);

    return new Promise((resolve) => {
      const approvalRl = createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true,
      });
      approvalRl.question(promptText, (answer) => {
        approvalRl.close();
        rl.resume();
        resolve(answer.toLowerCase() === 'y');
      });
    });
  };

  /**
   * Prompts for text input in the CLI.
   */
  const promptInput = async (promptText: string): Promise<string> => {
    rl.pause();
    process.stdin.setRawMode?.(false);

    return new Promise((resolve) => {
      const inputRl = createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true,
      });
      inputRl.question(promptText, (answer) => {
        inputRl.close();
        rl.resume();
        resolve(answer.trim());
      });
    });
  };

  // Handle local input requests from GatewayServer (for ask_user tool)
  server.on('input_request', async (payload: { id: string; description: string }) => {
    if (process.stdin.isTTY) {
      console.log(chalk.yellow(`\n  ❓ Input Requested: ${payload.description}`));
      const answer = await promptInput(chalk.cyan('  > '));
      server.resolveInput(payload.id, answer);
    }
  });

  // Re-wire the shell tool's approval callback to respect execution permissions and dashboard approvals
  toolRegistry.get('shell_execute')!.execute = createShellToolWithApproval(
    async (command, context) => {
      const latestConfig = loadConfig(projectRoot);
      const mode = latestConfig.execution?.shell || 'ask';
      const defaultChannel = latestConfig.execution?.defaultChannel;
      const defaultCommSkillId = latestConfig.execution?.defaultCommSkillId;

      if (mode === 'deny') {
        return {
          approved: false,
          mode,
          reason: 'policy_denied',
          defaultChannel,
          defaultCommSkillId,
        };
      }

      if (mode === 'auto') {
        return { approved: true, mode, defaultChannel, defaultCommSkillId };
      }

      // mode === 'ask'
      console.log(chalk.yellow(`  ⚠ shell approval required: ${command}`));
      const approved = await server.requestApproval({
        kind: 'shell',
        description: `shell_execute wants to run: ${command}`,
        meta: { command, defaultChannel, defaultCommSkillId },
        sessionId: context?.sessionId,
        workspaceId: context?.workspaceId,
      });

      if (approved !== undefined) {
        return {
          approved,
          mode,
          reason: approved ? undefined : 'user_denied',
          defaultChannel,
          defaultCommSkillId,
        };
      }

      if (process.stdin.isTTY) {
        const ttyApproved = await promptApproval(
          chalk.yellow(
            `\n  ⚠  Tool "shell_execute" wants to execute: ${chalk.bold(JSON.stringify({ command }))}\n  Approve? [y/N]: `,
          ),
        );
        return {
          approved: ttyApproved,
          mode,
          reason: ttyApproved ? undefined : 'user_denied',
          defaultChannel,
          defaultCommSkillId,
        };
      }

      return {
        approved: false,
        mode,
        reason: 'approval_required',
        defaultChannel,
        defaultCommSkillId,
        message: 'Command cancelled by user request. You may try again if necessary.',
      };
    },
  );

  // Re-wire the agent's approval callback too (used by tools marked requiresApproval)
  agent.setApprovalHandler(async (description) => {
    const approved = await server.requestApproval({
      kind: 'tool',
      description,
    });
    if (approved !== undefined) return approved;
    return promptApproval(chalk.yellow(`\n  ⚠  ${description}\n  Approve? [y/N]: `));
  });

  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();

    if (!input) {
      rl.prompt();
      return;
    }

    if (input.toLowerCase() === 'exit') {
      console.log(chalk.dim(`\n  ${config.agentName} is resting. Goodbye.\n`));
      permissionManager.stopWatching();
      await skillLoader.stop();
      await server.stop();
      process.exit(0);
    }

    if (input === '/clear') {
      agent.resetContext();
      console.log(chalk.dim('  Context cleared.\n'));
      rl.prompt();
      return;
    }

    if (input === '/status') {
      const usage = tokenTracker.getTotalUsage();
      console.log(
        chalk.dim(
          `  Tokens: ${usage.tokens} | Cost: $${usage.cost.toFixed(4)} | Connections: ${server.getConnectionCount()}`,
        ),
      );
      rl.prompt();
      return;
    }

    if (input === '/reload') {
      try {
        await reloadSkills();
        console.log(chalk.dim('  SOUL.md and skills reloaded.\n'));
      } catch (err: any) {
        console.log(chalk.red(`  Failed to reload skills: ${err?.message || err}\n`));
      }
      rl.prompt();
      return;
    }

    try {
      // Pause REPL while agent is processing to avoid stdin conflicts
      rl.pause();

      // Show thinking indicator
      process.stdout.write(chalk.dim('  thinking...\r'));

      const result = await agent.run(input, sessionId);

      // Clear thinking indicator and show response
      process.stdout.write('               \r');
      console.log();
      console.log(chalk.white('  ' + result.response.split('\n').join('\n  ')));
      console.log();

      if (result.toolCalls.length > 0) {
        console.log(
          chalk.dim(
            `  [${result.toolCalls.length} tool calls | trace: ${result.trace.id.slice(0, 8)}]`,
          ),
        );
      }

      const usage = tokenTracker.getSessionUsage(sessionId);
      console.log(chalk.dim(`  [tokens: ${usage.tokens} | cost: $${usage.cost.toFixed(4)}]`));
      console.log();
    } catch (error: any) {
      console.log(chalk.red(`  Error: ${error.message}\n`));
    }

    // Resume REPL after processing
    rl.resume();
    rl.prompt();
  });

  rl.on('close', () => shutdown());
};

// Only auto-start if run directly (node index.js)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startGateway().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
