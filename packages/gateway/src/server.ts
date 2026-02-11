import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import cors from '@fastify/cors';
import { parseFrame, serializeFrame, type WebSocketFrame } from '@adytum/shared';
import { auditLogger } from './security/audit-logger.js';
import { tokenTracker } from './agent/token-tracker.js';
import { EventEmitter } from 'node:events';
import { loadConfig, saveConfig } from './config.js';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import type { WebSocket } from 'ws';
import type { PermissionManager } from './security/permission-manager.js';
import type { HeartbeatManager } from './agent/heartbeat-manager.js';
import type { CronManager } from './agent/cron-manager.js';
import type { SkillLoader } from './agent/skill-loader.js';
import type { ToolRegistry } from './tools/registry.js';

export interface ServerConfig {
  port: number;
  host: string;
  permissionManager?: PermissionManager;
  workspacePath?: string;
  heartbeatManager?: HeartbeatManager;
  cronManager?: CronManager;
  skillLoader?: SkillLoader;
  toolRegistry?: ToolRegistry;
  /** Callback to reschedule dreamer/monologue intervals */
  onScheduleUpdate?: (type: 'dreamer' | 'monologue', intervalMinutes: number) => void;
  /** Callback to reload skills after config changes */
  onSkillsReload?: () => Promise<void>;
}

/**
 * Gateway Server — Fastify + WebSocket.
 * Manages client connections, routes messages to the agent runtime,
 * and streams events back to connected clients.
 */
export class GatewayServer extends EventEmitter {
  private app = Fastify({ logger: false });
  private connections = new Map<string, WebSocket>();
  private pendingApprovals: Map<
    string,
    { resolve: (v: boolean) => void; reject: (err: Error) => void; expiresAt: number; payload: any }
  > = new Map();
  private config: ServerConfig;

  constructor(config: ServerConfig) {
    super();
    this.config = config;
  }

  async start(): Promise<void> {
    await this.app.register(websocket);
    await this.app.register(cors, {
      origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
      methods: ['GET', 'POST', 'PUT', 'DELETE'],
    });

    // ─── REST Routes ────────────────────────────────────────
    this.app.get('/api/health', async () => ({
      status: 'alive',
      version: '0.1.0',
      connections: this.connections.size,
      uptime: process.uptime(),
      tokens: tokenTracker.getTotalUsage(),
    }));

    this.app.get('/api/tokens', async () => ({
      total: tokenTracker.getTotalUsage(),
      daily: tokenTracker.getDailyUsage(),
      recent: tokenTracker.getRecentRecords(20),
    }));

    this.app.get('/api/link-preview', async (request, reply) => {
      const { url } = request.query as { url?: string };
      if (!url || typeof url !== 'string') {
        return reply.status(400).send({ error: 'url query parameter is required' });
      }

      let target: URL;
      try {
        target = new URL(url);
      } catch {
        return reply.status(400).send({ error: 'Invalid URL' });
      }

      if (!isHttpUrl(target)) {
        return reply.status(400).send({ error: 'Only http/https URLs are allowed' });
      }

      if (!isLinkPreviewHostAllowed(target.hostname)) {
        return reply.status(400).send({ error: 'Blocked URL host' });
      }

      try {
        const preview = await fetchLinkPreview(target);
        return preview;
      } catch (err: any) {
        return reply.status(502).send({
          error: 'Failed to fetch preview',
          detail: err?.message || String(err),
        });
      }
    });

    this.app.get('/api/logs', async (request) => {
      const { limit, type } = request.query as { limit?: string; type?: string };
      const count = Math.min(Number(limit) || 50, 200);
      let logs = auditLogger.getRecentLogs(count);
      if (type) {
        logs = logs.filter((l) => l.actionType === type);
      }
      return { logs };
    });

    // ─── Activity Feed (traces with their logs) ─────────────
    this.app.get('/api/activity', async (request) => {
      const { limit, offset } = request.query as { limit?: string; offset?: string };
      const count = Math.min(Number(limit) || 30, 100);
      const skip = Number(offset) || 0;
      const logs = auditLogger.getRecentLogs(200);
      const sliced = logs.slice(skip, skip + count);
      return {
        activities: sliced,
        total: logs.length,
        hasMore: skip + count < logs.length,
      };
    });

    // ─── Feedback Submission ────────────────────────────────
    this.app.post('/api/feedback', async (request, reply) => {
      const body = request.body as {
        traceId: string;
        rating: 'up' | 'down';
        reasonCode?: string;
        comment?: string;
      };
      if (!body.traceId || !body.rating) {
        return reply.status(400).send({ error: 'traceId and rating required' });
      }
      const feedback = {
        id: crypto.randomUUID(),
        traceId: body.traceId,
        rating: body.rating === 'up' ? 1 : -1,
        reasonCode: body.reasonCode,
        comment: body.comment,
        createdAt: Date.now(),
      };
      auditLogger.log({
        traceId: body.traceId,
        actionType: 'message_received',
        payload: { feedback },
        status: 'success',
      });
      return { success: true, feedback };
    });

    // ─── Permissions Management ─────────────────────────────
    this.app.get('/api/permissions', async () => {
      if (!this.config.permissionManager) return { permissions: [] };
      return { permissions: this.config.permissionManager.getPermissions() };
    });

    this.app.post('/api/permissions/grant', async (request, reply) => {
      if (!this.config.permissionManager) {
        return reply.status(503).send({ error: 'Permission manager not available' });
      }
      const body = request.body as { path: string; mode: string; durationMs?: number };
      if (!body.path || !body.mode) {
        return reply.status(400).send({ error: 'path and mode required' });
      }
      this.config.permissionManager.grantAccess(body.path, body.mode as any, body.durationMs);
      return { success: true };
    });

    this.app.post('/api/permissions/revoke', async (request, reply) => {
      if (!this.config.permissionManager) {
        return reply.status(503).send({ error: 'Permission manager not available' });
      }
      const body = request.body as { path: string };
      if (!body.path) {
        return reply.status(400).send({ error: 'path required' });
      }
      this.config.permissionManager.revokeAccess(body.path);
      return { success: true };
    });

    // Execution permissions (shell, etc.)
    this.app.get('/api/execution/permissions', async () => {
      const cfg = loadConfig();
      const exec = cfg.execution || { shell: 'ask' as 'auto' | 'ask' | 'deny' };
      return {
        execution: {
          shell: exec.shell || 'ask',
          defaultChannel: exec.defaultChannel,
          defaultCommSkillId: exec.defaultCommSkillId,
        },
      };
    });

    this.app.put('/api/execution/permissions', async (request, reply) => {
      const body = request.body as {
        shell?: 'auto' | 'ask' | 'deny';
        defaultChannel?: string;
        defaultCommSkillId?: string;
      };
      const cfg = loadConfig();
      const next = {
        shell: body.shell || cfg.execution?.shell || 'ask',
        defaultChannel: body.defaultChannel ?? cfg.execution?.defaultChannel,
        defaultCommSkillId: body.defaultCommSkillId ?? cfg.execution?.defaultCommSkillId,
      };
      saveConfig({ execution: next } as any);
      return { success: true, execution: next };
    });

    // Skills permissions (global)
    this.app.put('/api/skills/permissions', async (request, reply) => {
      const body = request.body as { install?: 'auto' | 'ask' | 'deny'; defaultChannel?: string };
      const cfg = loadConfig();
      const skills =
        cfg.skills || {
          enabled: true,
          allow: [],
          deny: [],
          load: { paths: [], extraDirs: [] },
          permissions: { install: 'ask' as 'auto' | 'ask' | 'deny', defaultChannel: undefined },
          entries: {},
        };
      const next = {
        ...skills,
        permissions: {
          install: body.install || skills.permissions?.install || 'ask',
          defaultChannel: body.defaultChannel ?? skills.permissions?.defaultChannel,
        },
      };
      saveConfig({ skills: next } as any);
      return { success: true, permissions: next.permissions };
    });

    // ─── Skills Management ───────────────────────────────────
    this.app.get('/api/skills', async () => {
      const cfg = loadConfig();
      const skillsCfg: {
        enabled: boolean;
        allow: string[];
        deny: string[];
        load: { paths?: string[]; extraDirs?: string[] };
        permissions: { install: 'auto' | 'ask' | 'deny'; defaultChannel?: string };
        entries: Record<string, any>;
      } = (cfg.skills as any) || {
        enabled: true,
        allow: [],
        deny: [],
        load: { paths: [], extraDirs: [] },
        permissions: { install: 'ask', defaultChannel: undefined },
        entries: {},
      };
      const entries = skillsCfg.entries || {};
      const global = {
        enabled: skillsCfg.enabled ?? true,
        allow: skillsCfg.allow ?? [],
        deny: skillsCfg.deny ?? [],
        loadPaths: skillsCfg.load?.paths ?? [],
        extraDirs: skillsCfg.load?.extraDirs ?? [],
        permissions: {
          install: skillsCfg.permissions?.install ?? 'ask',
          defaultChannel: skillsCfg.permissions?.defaultChannel,
        },
      };

		  const skills = (this.config.skillLoader?.getAll() || []).map((skill) => ({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        version: skill.version,
        origin: skill.origin,
        status: skill.status,
        enabled: skill.enabled,
        error: skill.error,
        toolNames: skill.toolNames,
		    serviceIds: skill.serviceIds,
		    manifestPath: skill.manifestPath,
		    instructionFiles: skill.instructionFiles.map((filePath) => relative(skill.path, filePath)),
        missing: skill.missing,
        eligible: skill.eligible,
        communication: skill.communication === true,
        install: skill.install || [],
		    manifest: skill.manifest
          ? {
              id: skill.manifest.id,
              name: skill.manifest.name,
              description: skill.manifest.description,
              version: skill.manifest.version,
              kind: skill.manifest.kind,
              channels: skill.manifest.channels || [],
              providers: skill.manifest.providers || [],
              configSchema: skill.manifest.configSchema,
              uiHints: skill.manifest.uiHints || {},
            }
          : null,
        configEntry: entries[skill.id] || {},
      }));

		  return { skills, global };
		});

    this.app.post('/api/skills/:id/install', async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as { approve?: boolean };
      const cfg = loadConfig();
      const skillsCfg: {
        permissions: { install: 'auto' | 'ask' | 'deny'; defaultChannel?: string };
        entries: Record<string, any>;
      } = (cfg.skills as any) || { permissions: { install: 'ask' }, entries: {} };
      const skill = this.config.skillLoader?.getAll().find((s) => s.id === id);
      if (!skill) {
        return reply.status(404).send({ error: `Unknown skill: ${id}` });
      }
      const installSpecs = skill.install || [];
      if (installSpecs.length === 0) {
        return reply.status(400).send({ error: 'No install specs found for this skill' });
      }
      const effectivePermission =
        (skillsCfg.entries?.[id]?.installPermission as 'auto' | 'ask' | 'deny' | undefined) ||
        (skillsCfg.permissions?.install as 'auto' | 'ask' | 'deny' | undefined) ||
        'ask';
      if (effectivePermission === 'deny') {
        return reply.status(403).send({ error: 'Install denied by policy' });
      }
      if (effectivePermission === 'ask' && !body?.approve) {
        return reply.status(409).send({
          error: 'approval_required',
          message: 'Installation requires approval',
          defaultChannel: skillsCfg.permissions?.defaultChannel,
        });
      }
      const selected =
        installSpecs.find(
          (spec) =>
            spec &&
            typeof spec === 'object' &&
            (spec.os === undefined ||
              (Array.isArray(spec.os) && spec.os.length === 0) ||
              (Array.isArray(spec.os) && spec.os.map(String).includes(process.platform))),
        ) || installSpecs[0];
      if (!selected || typeof selected !== 'object' || !selected.kind) {
        return reply.status(400).send({ error: 'Unsupported install spec' });
      }
      try {
        await runInstall(selected as any);
        if (this.config.onSkillsReload) {
          await this.config.onSkillsReload();
        }
        return { success: true, message: 'Install completed' };
      } catch (err: any) {
        return reply.status(500).send({ error: 'Install failed', detail: err?.message || String(err) });
      }
    });

    this.app.get('/api/skills/:id/instructions', async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!this.config.skillLoader) {
        return reply.status(503).send({ error: 'Skill loader not available' });
      }

	      const knownSkill = this.config.skillLoader.getAll().find((skill) => skill.id === id);
	      if (!knownSkill) {
	        return reply.status(404).send({ error: `Unknown skill: ${id}` });
	      }

	      const files = getInstructionFilesForSkill(knownSkill);
	      const payload = files.map((filePath) => ({
	        path: filePath,
	        relativePath: relative(knownSkill.path, filePath),
	        content: readFileSync(filePath, 'utf-8'),
	        editable: true,
	      }));

	      return {
	        files: payload,
	        combined: knownSkill.instructions,
	      };
	    });

	    this.app.put('/api/skills/:id/instructions', async (request, reply) => {
	      const { id } = request.params as { id: string };
	      const body = request.body as {
	        relativePath?: string;
	        content?: string;
	      };

	      if (!this.config.skillLoader) {
	        return reply.status(503).send({ error: 'Skill loader not available' });
	      }

	      const knownSkill = this.config.skillLoader.getAll().find((skill) => skill.id === id);
	      if (!knownSkill) {
	        return reply.status(404).send({ error: `Unknown skill: ${id}` });
	      }

	      if (typeof body.content !== 'string') {
	        return reply.status(400).send({ error: 'content string required' });
	      }

	      const instructionFiles = getInstructionFilesForSkill(knownSkill);
	      let targetRelativePath = body.relativePath?.trim();
	      let targetPath: string | undefined;

	      if (targetRelativePath) {
	        targetPath = instructionFiles.find(
	          (filePath) => relative(knownSkill.path, filePath) === targetRelativePath,
	        );
	        if (!targetPath) {
	          return reply.status(400).send({
	            error: `relativePath must reference one of the skill instruction files: ${instructionFiles
	              .map((filePath) => relative(knownSkill.path, filePath))
	              .join(', ')}`,
	          });
	        }
	      } else if (instructionFiles.length > 0) {
	        targetPath = instructionFiles[0];
	        targetRelativePath = relative(knownSkill.path, targetPath);
	      } else {
	        targetPath = resolve(knownSkill.path, 'SKILL.md');
	        targetRelativePath = 'SKILL.md';
	      }

	      const resolvedTarget = resolve(targetPath);
	      const resolvedRoot = resolve(knownSkill.path);
	      if (!resolvedTarget.startsWith(`${resolvedRoot}/`) && resolvedTarget !== resolvedRoot) {
	        return reply.status(400).send({ error: 'Instruction target must stay within skill directory' });
	      }

	      writeFileSync(resolvedTarget, body.content, 'utf-8');

	      if (this.config.onSkillsReload) {
	        try {
	          await this.config.onSkillsReload();
	        } catch (err: any) {
	          return reply.status(500).send({
	            error: `Instruction saved but skill reload failed: ${err?.message || err}`,
	          });
	        }
	      }

	      return {
	        success: true,
	        relativePath: targetRelativePath,
	      };
	    });

    this.app.put('/api/skills/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as {
        enabled?: boolean;
        config?: Record<string, unknown>;
        env?: Record<string, string>;
        apiKey?: string;
        installPermission?: 'auto' | 'ask' | 'deny';
      };

      if (!this.config.skillLoader) {
        return reply.status(503).send({ error: 'Skill loader not available' });
      }

      const knownSkill = this.config.skillLoader.getAll().find((skill) => skill.id === id);
      if (!knownSkill) {
        return reply.status(404).send({ error: `Unknown skill: ${id}` });
      }

      const hasEnabled = typeof body.enabled === 'boolean';
      const hasConfig = body.config !== undefined;
      const hasEnv = body.env !== undefined;
      const hasApiKey = body.apiKey !== undefined;
      const hasInstallPerm = body.installPermission !== undefined;
      if (!hasEnabled && !hasConfig && !hasEnv && !hasApiKey && !hasInstallPerm) {
        return reply.status(400).send({ error: 'Provide at least one of: enabled, config, env, apiKey, installPermission' });
      }

      if (
        hasConfig &&
        (typeof body.config !== 'object' || body.config === null || Array.isArray(body.config))
      ) {
        return reply.status(400).send({ error: 'config must be an object' });
      }
      if (
        hasEnv &&
        (typeof body.env !== 'object' || body.env === null || Array.isArray(body.env))
      ) {
        return reply.status(400).send({ error: 'env must be an object' });
      }

      const cfg = loadConfig();
      const currentSkills = cfg.skills || {
        enabled: true,
        allow: [],
        deny: [],
        load: { paths: [] },
        entries: {},
      };
      const currentEntries: Record<string, any> = currentSkills.entries || {};
      const currentEntry: Record<string, any> = currentEntries[id] || {};

      const nextEntry = {
        ...currentEntry,
        ...(hasEnabled ? { enabled: body.enabled } : {}),
        ...(hasConfig ? { config: body.config } : {}),
        ...(hasEnv ? { env: body.env } : {}),
        ...(hasApiKey ? { apiKey: body.apiKey } : {}),
        ...(hasInstallPerm ? { installPermission: body.installPermission } : {}),
      };

      const nextSkills = {
        enabled: currentSkills.enabled ?? true,
        allow: currentSkills.allow || [],
        deny: currentSkills.deny || [],
        load: { paths: currentSkills.load?.paths || [] },
        entries: {
          ...currentEntries,
          [id]: nextEntry,
        },
      };

      saveConfig({ skills: nextSkills } as any);

      if (this.config.onSkillsReload) {
        try {
          await this.config.onSkillsReload();
        } catch (err: any) {
          return reply.status(500).send({
            error: `Config saved but skill reload failed: ${err?.message || err}`,
          });
        }
      }

      return { success: true };
    });

    // ─── SOUL.md / Personality ───────────────────────────────
    this.app.get('/api/personality', async () => {
      if (!this.config.workspacePath) return { content: '' };
      const { readFileSync, existsSync } = await import('node:fs');
      const { join } = await import('node:path');
      const soulPath = join(this.config.workspacePath, 'SOUL.md');
      if (!existsSync(soulPath)) return { content: '' };
      return { content: readFileSync(soulPath, 'utf-8') };
    });

    this.app.put('/api/personality', async (request, reply) => {
      if (!this.config.workspacePath) {
        return reply.status(503).send({ error: 'Workspace path not configured' });
      }
      const { content } = request.body as { content: string };
      if (typeof content !== 'string') {
        return reply.status(400).send({ error: 'content string required' });
      }
      const { writeFileSync } = await import('node:fs');
      const { join } = await import('node:path');
      writeFileSync(join(this.config.workspacePath, 'SOUL.md'), content, 'utf-8');
      return { success: true };
    });

    // ─── HEARTBEAT.md / Goals ────────────────────────────────
    this.app.get('/api/heartbeat', async () => {
      if (!this.config.workspacePath) return { content: '' };
      const { readFileSync, existsSync } = await import('node:fs');
      const { join } = await import('node:path');
      const hbPath = join(this.config.workspacePath, 'HEARTBEAT.md');
      if (!existsSync(hbPath)) return { content: '' };
      return { content: readFileSync(hbPath, 'utf-8') };
    });

    this.app.put('/api/heartbeat', async (request, reply) => {
      if (!this.config.workspacePath) {
        return reply.status(503).send({ error: 'Workspace path not configured' });
      }
      const { content } = request.body as { content: string };
      if (typeof content !== 'string') {
        return reply.status(400).send({ error: 'content string required' });
      }
      const { writeFileSync } = await import('node:fs');
      const { join } = await import('node:path');
      writeFileSync(join(this.config.workspacePath, 'HEARTBEAT.md'), content, 'utf-8');
      return { success: true };
    });

    this.app.get('/api/heartbeat/config', async (request, reply) => {
       if (!this.config.heartbeatManager) {
         // Fallback if not injected, although it should be
         return reply.status(503).send({ error: 'Heartbeat manager not available' });
       }
       // We need to read the current config. Ideally we should have access to the full config object
       // But we can get it from the manager if we exposed it, or re-read it.
       // Simpler: The manager likely knows its interval? Actually I didn't expose getInterval.
       // Let's just read it from the config file or assume standard.
       // Better: read Adytum config again or rely on what was passed.
       // Since I don't have easy access to the global `config` object here (it's in index.ts),
       // I will import `loadConfig` to get the cached one.
       const { loadConfig } = await import('./config.js');
       const cfg = loadConfig();
       return { interval: cfg.heartbeatIntervalMinutes };
    });

    this.app.put('/api/heartbeat/config', async (request, reply) => {
       if (!this.config.heartbeatManager) {
         return reply.status(503).send({ error: 'Heartbeat manager not available' });
       }
       const body = request.body as { interval: number };
       const interval = Number(body.interval);
       if (!interval || interval < 1) {
         return reply.status(400).send({ error: 'Invalid interval' });
       }

       // 1. Update runtime manager
       this.config.heartbeatManager.schedule(interval);

       // 2. Persist to config
       saveConfig({ heartbeatIntervalMinutes: interval });

       return { success: true, interval };
    });

    // ─── Schedule Settings (Dreamer / Monologue / Heartbeat) ─
    this.app.get('/api/schedules', async () => {
       const { loadConfig } = await import('./config.js');
       const cfg = loadConfig();
       return {
         heartbeat: cfg.heartbeatIntervalMinutes,
         dreamer: cfg.dreamerIntervalMinutes,
         monologue: cfg.monologueIntervalMinutes,
       };
    });

    this.app.put('/api/schedules', async (request, reply) => {
       const body = request.body as {
         heartbeat?: number;
         dreamer?: number;
         monologue?: number;
       };

       const updates: Record<string, number> = {};
       const results: Record<string, number> = {};

       if (body.heartbeat && body.heartbeat >= 1) {
         const interval = Math.floor(body.heartbeat);
         if (this.config.heartbeatManager) {
           this.config.heartbeatManager.schedule(interval);
         }
         updates.heartbeatIntervalMinutes = interval;
         results.heartbeat = interval;
       }

       if (body.dreamer && body.dreamer >= 1) {
         const interval = Math.floor(body.dreamer);
         this.config.onScheduleUpdate?.('dreamer', interval);
         updates.dreamerIntervalMinutes = interval;
         results.dreamer = interval;
       }

       if (body.monologue && body.monologue >= 1) {
         const interval = Math.floor(body.monologue);
         this.config.onScheduleUpdate?.('monologue', interval);
         updates.monologueIntervalMinutes = interval;
         results.monologue = interval;
       }

       if (Object.keys(updates).length === 0) {
         return reply.status(400).send({ error: 'Provide at least one of: heartbeat, dreamer, monologue (minutes, >= 1)' });
       }

       // Persist to config file
       saveConfig(updates);

       return { success: true, ...results };
    });

    // ─── Cron Jobs API ──────────────────────────────────────
    this.app.get('/api/cron', async () => {
       if (!this.config.cronManager) return { jobs: [] };
       return { jobs: this.config.cronManager.getAllJobs() };
    });

    this.app.post('/api/cron', async (request, reply) => {
       if (!this.config.cronManager) return reply.status(503).send({ error: 'Cron manager not available' });
       const { name, schedule, task } = request.body as any;
       if (!name || !schedule || !task) return reply.status(400).send({ error: 'Missing fields' });
       
       try {
           const job = this.config.cronManager.addJob(name, schedule, task);
           return { job };
       } catch (err: any) {
           return reply.status(400).send({ error: err.message });
       }
    });

    this.app.put('/api/cron/:id', async (request, reply) => {
        if (!this.config.cronManager) return reply.status(503).send({ error: 'Cron manager not available' });
        const { id } = request.params as { id: string };
        const updates = request.body as any;
        
        try {
            const job = this.config.cronManager.updateJob(id, updates);
            return { job };
        } catch (err: any) {
            return reply.status(404).send({ error: err.message });
        }
    });

    this.app.delete('/api/cron/:id', async (request, reply) => {
        if (!this.config.cronManager) return reply.status(503).send({ error: 'Cron manager not available' });
        const { id } = request.params as { id: string };
        this.config.cronManager.removeJob(id);
        return { success: true };
    });

    // ─── WebSocket Route ────────────────────────────────────
    this.app.get('/ws', { websocket: true }, (socket, req) => {
      let sessionId: string | null = null;

      socket.on('message', (raw: Buffer) => {
        try {
          const frame = parseFrame(raw.toString());

          if (frame.type === 'connect') {
            sessionId = frame.sessionId || crypto.randomUUID();
            if (sessionId) {
              this.connections.set(sessionId, socket);

              this.sendFrame(socket, {
                type: 'connect',
                channel: frame.channel,
                sessionId,
              });

              this.emit('client_connected', { sessionId, channel: frame.channel });
            }
            return;
          }

          if (!sessionId) {
            this.sendFrame(socket, {
              type: 'error',
              code: 'NO_SESSION',
              message: 'Must send connect frame first',
            });
            socket.close();
            return;
          }

          // Handle approval responses
          if (frame.type === 'approval_response' && frame.id) {
            const pending = this.pendingApprovals.get(frame.id);
            if (pending) {
              this.pendingApprovals.delete(frame.id);
              pending.resolve(Boolean(frame.approved));
              return;
            }
          }

          // Route frame to handler
          this.emit('frame', { sessionId, frame });
        } catch (error: any) {
          this.sendFrame(socket, {
            type: 'error',
            code: 'INVALID_FRAME',
            message: `Malformed frame: ${error.message}`,
          });
          socket.close();
        }
      });

      socket.on('close', () => {
        if (sessionId) {
          this.connections.delete(sessionId);
          this.emit('client_disconnected', { sessionId });
        }
      });
    });

    // Listen on audit and token events to broadcast to connected clients
    auditLogger.on('log', (entry: any) => {
      this.broadcastToAll({
        type: 'stream',
        sessionId: '00000000-0000-0000-0000-000000000000',
        traceId: entry.traceId,
        streamType: 'status',
        delta: `[${entry.actionType}] ${JSON.stringify(entry.payload).slice(0, 200)}`,
      });
    });

    tokenTracker.on('token_update', (update: any) => {
      this.broadcastToAll({
        type: 'token_update',
        ...update,
      });
    });

    await this.app.listen({ port: this.config.port, host: this.config.host });
  }

  /** Send a frame to a specific session. */
  sendToSession(sessionId: string, frame: WebSocketFrame): void {
    const socket = this.connections.get(sessionId);
    if (socket?.readyState === 1) {
      this.sendFrame(socket, frame);
    }
  }

  async requestApproval(payload: { kind: string; description: string; meta?: Record<string, unknown> }): Promise<boolean> {
    const id = crypto.randomUUID();
    const expiresAt = Date.now() + 60_000;

    const promise = new Promise<boolean>((resolve, reject) => {
      this.pendingApprovals.set(id, { resolve, reject, expiresAt, payload });
    });

    this.broadcastToAll({
      type: 'approval_request',
      id,
      kind: payload.kind,
      description: payload.description,
      meta: payload.meta || {},
      expiresAt,
    });

    // Notify via communication skill if configured
    const cfg = loadConfig();
    const defaultCommSkillId =
      cfg.execution?.defaultCommSkillId ||
      this.config.skillLoader
        ?.getAll()
        .find((s) => s.communication)?.id;
    const defaultChannel = cfg.execution?.defaultChannel;
    if (defaultCommSkillId && defaultChannel && this.config.toolRegistry) {
      let sendTool =
        this.config.toolRegistry.get(`${defaultCommSkillId}_send`) ||
        (defaultCommSkillId === 'discord' ? this.config.toolRegistry.get('discord_send') : null) ||
        (defaultCommSkillId === 'slack' ? this.config.toolRegistry.get('slack_send') : null) ||
        this.config.toolRegistry.get('discord_send');

      if (sendTool) {
        // fire and forget
        sendTool
          .execute({
            channelId: defaultChannel,
            content: `Approval needed: ${payload.description}\nRequest ID: ${id}`,
          })
          .catch((err: any) => {
            console.warn('[approval] failed to send comm notification:', err?.message || err);
          });
      } else {
        console.warn('[approval] no send tool found for comm skill', defaultCommSkillId);
      }
    }

    // Auto-expire
    setTimeout(() => {
      const pending = this.pendingApprovals.get(id);
      if (pending && Date.now() >= expiresAt) {
        this.pendingApprovals.delete(id);
        pending.resolve(false);
      }
    }, 61_000);

    return promise;
  }

  /** Broadcast a frame to all connected clients. */
  broadcastToAll(frame: WebSocketFrame): void {
    const data = serializeFrame(frame);
    for (const socket of this.connections.values()) {
      if (socket.readyState === 1) {
        socket.send(data);
      }
    }
  }

  /** Get connection count. */
  getConnectionCount(): number {
    return this.connections.size;
  }

  async stop(): Promise<void> {
    for (const socket of this.connections.values()) {
      socket.close();
    }
    this.connections.clear();
    await this.app.close();
  }

	  private sendFrame(socket: WebSocket, frame: WebSocketFrame): void {
	    socket.send(serializeFrame(frame));
	  }
	}

function getInstructionFilesForSkill(skill: { path: string; instructionFiles: string[] }): string[] {
  const files = skill.instructionFiles.filter((filePath) => existsSync(filePath));
  if (files.length > 0) return files;

  const fallback = join(skill.path, 'SKILL.md');
  if (existsSync(fallback)) return [fallback];
  return [];
}

interface LinkPreviewPayload {
  url: string;
  domain: string;
  title: string;
  description: string;
  image?: string;
  favicon: string;
  contentType: string;
  status: number;
}

const LINK_PREVIEW_TIMEOUT_MS = 8_000;
const LINK_PREVIEW_MAX_REDIRECTS = 3;
const LINK_PREVIEW_BLOCKED_HOSTS = new Set([
  'localhost',
  'localhost.localdomain',
  '0.0.0.0',
  '127.0.0.1',
  '::1',
]);

async function fetchLinkPreview(initialUrl: URL): Promise<LinkPreviewPayload> {
  let current = new URL(initialUrl.toString());

  for (let redirects = 0; redirects <= LINK_PREVIEW_MAX_REDIRECTS; redirects += 1) {
    const response = await fetch(current.toString(), {
      method: 'GET',
      redirect: 'manual',
      headers: {
        'User-Agent': 'Adytum-LinkPreview/0.1',
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(LINK_PREVIEW_TIMEOUT_MS),
    });

    if (isRedirectStatus(response.status)) {
      const location = response.headers.get('location');
      if (location) {
        const next = new URL(location, current);
        if (!isHttpUrl(next)) {
          throw new Error('Redirected to non-http URL');
        }
        if (!isLinkPreviewHostAllowed(next.hostname)) {
          throw new Error('Redirected to blocked host');
        }
        current = next;
        continue;
      }
    }

    const html = await response.text();
    const contentType = response.headers.get('content-type') || '';
    const pageUrl = current.toString();
    const domain = current.hostname;
    const origin = `${current.protocol}//${current.host}`;

    const title = firstNonEmpty(
      extractMetaContent(html, 'property', 'og:title'),
      extractMetaContent(html, 'name', 'twitter:title'),
      extractHtmlTitle(html),
    );
    const description = firstNonEmpty(
      extractMetaContent(html, 'property', 'og:description'),
      extractMetaContent(html, 'name', 'description'),
      extractMetaContent(html, 'name', 'twitter:description'),
    );
    const image = firstNonEmpty(
      extractMetaContent(html, 'property', 'og:image'),
      extractMetaContent(html, 'name', 'twitter:image'),
    );

    return {
      url: pageUrl,
      domain,
      title: title || domain,
      description: description || '',
      image: image ? absolutizeMetaUrl(image, pageUrl) : undefined,
      favicon: `${origin}/favicon.ico`,
      contentType,
      status: response.status,
    };
  }

  throw new Error('Too many redirects');
}

function isHttpUrl(url: URL): boolean {
  return url.protocol === 'http:' || url.protocol === 'https:';
}

function isRedirectStatus(status: number): boolean {
  return status >= 300 && status < 400;
}

function isLinkPreviewHostAllowed(hostname: string): boolean {
  const normalized = hostname.trim().replace(/\.$/, '').toLowerCase();
  if (!normalized) return false;
  if (normalized.endsWith('.local') || normalized.endsWith('.localhost')) return false;
  if (LINK_PREVIEW_BLOCKED_HOSTS.has(normalized)) return false;

  const unwrapped = normalized.replace(/^\[/, '').replace(/\]$/, '');
  if (isIpv4Address(unwrapped) || isIpv6Address(unwrapped)) return false;

  return true;
}

function isIpv4Address(host: string): boolean {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(host);
}

function isIpv6Address(host: string): boolean {
  return host.includes(':') && /^[0-9a-f:.]+$/i.test(host);
}

function extractMetaContent(
  html: string,
  key: 'property' | 'name',
  expected: string,
): string | undefined {
  const target = expected.toLowerCase();
  for (const match of html.matchAll(/<meta\s+[^>]*>/gi)) {
    const attributes = parseHtmlAttributes(match[0]);
    if ((attributes[key] || '').toLowerCase() !== target) continue;
    const content = attributes.content?.trim();
    if (content) return content;
  }
  return undefined;
}

function extractHtmlTitle(html: string): string | undefined {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!titleMatch) return undefined;
  return normalizeWhitespace(stripHtmlTags(decodeHtmlEntities(titleMatch[1]))).trim();
}

function absolutizeMetaUrl(value: string, baseUrl: string): string | undefined {
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return undefined;
  }
}

function runInstall(spec: {
  kind: string;
  formula?: string;
  package?: string;
  module?: string;
  url?: string;
  archive?: boolean;
  extract?: boolean;
  targetDir?: string;
  stripComponents?: number;
}): Promise<void> {
  const kind = String(spec.kind || '').toLowerCase();
  if (kind === 'brew') {
    if (!spec.formula) {
      return Promise.reject(new Error('brew install requires formula'));
    }
    const formula: string = spec.formula;
    return new Promise((resolve, reject) => {
      const child = execFile(
        'brew',
        ['install', formula],
        { timeout: 15 * 60 * 1000 },
        (err: any, _stdout: any, stderr: any) => {
          if (err) {
            reject(new Error(stderr || err.message));
            return;
          }
          resolve();
        },
      );
      child.stdout?.on('data', (d) => console.log(String(d)));
      child.stderr?.on('data', (d) => console.warn(String(d)));
    });
  }

  if (kind === 'node') {
    const pkg = spec.package;
    if (!pkg) return Promise.reject(new Error('node install requires package'));
    return new Promise((resolve, reject) => {
      const child = execFile('npm', ['install', '-g', pkg], { timeout: 15 * 60 * 1000 }, (err, _stdout, stderr) => {
        if (err) return reject(new Error(stderr || err.message));
        resolve();
      });
      child.stdout?.on('data', (d) => console.log(String(d)));
      child.stderr?.on('data', (d) => console.warn(String(d)));
    });
  }

  if (kind === 'go') {
    const mod = spec.module;
    if (!mod) return Promise.reject(new Error('go install requires module'));
    return new Promise((resolve, reject) => {
      const child = execFile('go', ['install', `${mod}@latest`], { timeout: 15 * 60 * 1000 }, (err, _stdout, stderr) => {
        if (err) return reject(new Error(stderr || err.message));
        resolve();
      });
      child.stdout?.on('data', (d) => console.log(String(d)));
      child.stderr?.on('data', (d) => console.warn(String(d)));
    });
  }

  if (kind === 'uv') {
    const mod = spec.module || spec.package;
    if (!mod) return Promise.reject(new Error('uv install requires module'));
    return new Promise((resolve, reject) => {
      const child = execFile('uv', ['tool', 'install', mod], { timeout: 15 * 60 * 1000 }, (err, _stdout, stderr) => {
        if (err) return reject(new Error(stderr || err.message));
        resolve();
      });
      child.stdout?.on('data', (d) => console.log(String(d)));
      child.stderr?.on('data', (d) => console.warn(String(d)));
    });
  }

  if (kind === 'download') {
    const url = spec.url;
    if (!url) return Promise.reject(new Error('download install requires url'));
    const downloadUrl: string = url;
    const targetDir: string = spec.targetDir || '/tmp';
    const archive = spec.archive !== false; // default true
    const strip = spec.stripComponents ?? 0;
    const tempFile = `/tmp/adytum-skill-download-${Date.now()}.tar`;
    return new Promise((resolve, reject) => {
      const curl = execFile(
        'curl',
        ['-L', '-o', tempFile, downloadUrl],
        { timeout: 10 * 60 * 1000 },
        (err: any, _stdout: any, stderr: any) => {
          if (err) {
            reject(new Error(stderr || err.message));
            return;
          }
          if (!archive) {
            resolve();
            return;
          }
          const args: string[] = ['-xf', tempFile, '-C', targetDir];
          if (strip > 0) {
            args.splice(2, 0, `--strip-components=${strip}`);
          }
          execFile('tar', args, { timeout: 10 * 60 * 1000 }, (tarErr: any, _so: any, stde: any) => {
            if (tarErr) {
              reject(new Error(stde || tarErr.message));
              return;
            }
            resolve();
          });
        },
      );
      curl.stdout?.on('data', (d) => console.log(String(d)));
      curl.stderr?.on('data', (d) => console.warn(String(d)));
    });
  }

  return Promise.reject(new Error(`Unsupported install kind: ${kind}`));
}

function firstNonEmpty(...values: Array<string | undefined | null>): string | undefined {
  for (const value of values) {
    if (value && value.trim()) return value.trim();
  }
  return undefined;
}

function parseHtmlAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const regex =
    /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;

  let match: RegExpExecArray | null = regex.exec(tag);
  while (match) {
    const key = match[1].toLowerCase();
    const value = match[3] ?? match[4] ?? match[5] ?? '';
    attributes[key] = decodeHtmlEntities(value);
    match = regex.exec(tag);
  }

  return attributes;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&nbsp;/gi, ' ');
}

function stripHtmlTags(value: string): string {
  return value.replace(/<[^>]+>/g, '');
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ');
}
