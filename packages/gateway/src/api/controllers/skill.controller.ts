/**
 * @file packages/gateway/src/api/controllers/skill.controller.ts
 * @description Handles API controller orchestration and response shaping.
 */

import { FastifyReply, FastifyRequest } from 'fastify';
import { singleton, inject } from 'tsyringe';
import { SkillService } from '../../application/services/skill-service.js';
import { loadConfig } from '../../config.js';
import { AppError } from '../../domain/errors/app-error.js';

/**
 * Encapsulates skill controller behavior.
 */
@singleton()
export class SkillController {
  constructor(@inject(SkillService) private skillService: SkillService) {}

  /**
   * Retrieves skills.
   * @param request - Request.
   * @param reply - Reply.
   */
  public async getSkills(request: FastifyRequest, reply: FastifyReply) {
    await this.skillService.migrateEmailCalendarLegacyConfig();
    const skills = this.skillService.getAllSkills();
    const config = loadConfig();
    const skillsCfg = config.skills || {
      enabled: true,
      allow: [],
      deny: [],
      load: { paths: [], extraDirs: [] },
      permissions: { install: 'ask' },
      entries: {},
    };

    const formattedSkills = skills.map((skill) => ({
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
      missing: skill.missing,
      eligible: skill.eligible,
      communication: skill.communication === true,
      install: skill.install || [],
      manifest: skill.manifest,
      requiredEnv: [
        ...(skill.manifest?.metadata?.requires?.env || []),
        ...(skill.manifest?.metadata?.primaryEnv ? [skill.manifest.metadata.primaryEnv] : []),
      ].filter(Boolean),
      secrets: this.skillService.getSkillSecretKeys(skill.id),
      configEntry: skillsCfg.entries?.[skill.id] || {},
      readonly: skill.readonly,
    }));

    return {
      skills: formattedSkills,
      global: {
        enabled: skillsCfg.enabled,
        permissions: skillsCfg.permissions,
      },
    };
  }

  /**
   * Retrieves skill.
   * @param request - Request.
   * @param reply - Reply.
   */
  public async getSkill(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as { id: string };
    if (id === 'email-calendar') {
      await this.skillService.migrateEmailCalendarLegacyConfig();
    }
    const skill = this.skillService.getSkill(id);
    if (!skill) {
      throw new AppError(`Skill ${id} not found`, 404);
    }

    const config = loadConfig();
    const skillsCfg = config.skills || {
      enabled: true,
      allow: [],
      deny: [],
      load: { paths: [], extraDirs: [] },
      permissions: { install: 'ask' },
      entries: {},
    };

    const formatted = {
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
      missing: skill.missing,
      eligible: skill.eligible,
      communication: skill.communication === true,
      install: skill.install || [],
      manifest: skill.manifest,
      requiredEnv: [
        ...(skill.manifest?.metadata?.requires?.env || []),
        ...(skill.manifest?.metadata?.primaryEnv ? [skill.manifest.metadata.primaryEnv] : []),
      ].filter(Boolean),
      secrets: this.skillService.getSkillSecretKeys(skill.id),
      configEntry: skillsCfg.entries?.[skill.id] || {},
      readonly: skill.readonly,
      instructions: skill.instructions,
    };

    return { skill: formatted };
  }

  /**
   * Retrieves skill instructions.
   * @param request - Request.
   * @param reply - Reply.
   */
  public async getSkillInstructions(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as { id: string };
    const instructions = this.skillService.getSkillInstructions(id);
    if (!instructions) {
      throw new AppError(`Skill ${id} not found`, 404);
    }
    return instructions;
  }

  /**
   * Executes update skill instructions.
   * @param request - Request.
   * @param reply - Reply.
   */
  public async updateSkillInstructions(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as { id: string };
    const { relativePath, content } = request.body as { relativePath: string; content: string };

    if (!relativePath || content === undefined) {
      throw new AppError('relativePath and content are required', 400);
    }

    await this.skillService.updateSkillInstructions(id, relativePath, content);
    return { success: true };
  }

  /**
   * Executes update skill.
   * @param request - Request.
   * @param reply - Reply.
   */
  public async updateSkill(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as { id: string };
    const data = request.body as {
      enabled?: boolean;
      config?: Record<string, unknown>;
      installPermission?: string;
    };

    await this.skillService.updateSkill(id, data);
    return { success: true };
  }

  /**
   * Executes update skill secrets.
   * @param request - Request.
   * @param reply - Reply.
   */
  public async updateSkillSecrets(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as { id: string };
    const { secrets } = request.body as { secrets: Record<string, string> };

    if (!secrets) {
      throw new AppError('secrets are required', 400);
    }

    await this.skillService.setSkillSecrets(id, secrets);
    return { success: true };
  }

  /**
   * Starts Google OAuth for email-calendar skill.
   * @param request - Request.
   * @param reply - Reply.
   */
  public async startEmailCalendarGoogleOAuth(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as { id: string };
    if (id !== 'email-calendar') {
      throw new AppError('OAuth start is supported only for email-calendar.', 400);
    }

    const body = (request.body || {}) as {
      accountId?: string;
      label?: string;
      loginHint?: string;
      callbackBaseUrl?: string;
    };

    const callbackBaseUrl = cleanUrl(body.callbackBaseUrl) || this.resolvePublicBaseUrl(request);
    const result = await this.skillService.startEmailCalendarGoogleOAuth({
      accountId: body.accountId,
      label: body.label,
      loginHint: body.loginHint,
      callbackBaseUrl,
    });
    return result;
  }

  /**
   * Handles Google OAuth callback for email-calendar skill.
   * @param request - Request.
   * @param reply - Reply.
   */
  public async handleEmailCalendarGoogleOAuthCallback(
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    const { id } = request.params as { id: string };
    if (id !== 'email-calendar') {
      throw new AppError('OAuth callback is supported only for email-calendar.', 400);
    }

    const query = request.query as {
      state?: string;
      code?: string;
      error?: string;
      error_description?: string;
    };
    const result = await this.skillService.handleEmailCalendarGoogleOAuthCallback({
      state: query.state,
      code: query.code,
      error: query.error,
      errorDescription: query.error_description,
    });

    const html = this.buildOAuthPopupHtml(result.status, result.accountId, result.email);
    reply.type('text/html; charset=utf-8').send(html);
  }

  /**
   * Retrieves OAuth status for email-calendar.
   * @param request - Request.
   * @param reply - Reply.
   */
  public async getEmailCalendarGoogleOAuthStatus(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as { id: string };
    if (id !== 'email-calendar') {
      throw new AppError('OAuth status is supported only for email-calendar.', 400);
    }
    const { state } = request.query as { state?: string };
    if (!state) {
      throw new AppError('state query parameter is required', 400);
    }
    return this.skillService.getEmailCalendarGoogleOAuthStatus(state);
  }

  /**
   * Lists OAuth accounts for email-calendar.
   * @param request - Request.
   * @param reply - Reply.
   */
  public async listEmailCalendarGoogleOAuthAccounts(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as { id: string };
    if (id !== 'email-calendar') {
      throw new AppError('OAuth accounts are supported only for email-calendar.', 400);
    }
    return await this.skillService.listEmailCalendarGoogleOAuthAccounts();
  }

  /**
   * Removes OAuth account for email-calendar.
   * @param request - Request.
   * @param reply - Reply.
   */
  public async removeEmailCalendarAccount(request: FastifyRequest, reply: FastifyReply) {
    const { id, accountId } = request.params as { id: string; accountId: string };
    if (id !== 'email-calendar') {
      throw new AppError('Account removal is supported only for email-calendar.', 400);
    }
    await this.skillService.removeEmailCalendarAccount(accountId);
    return { success: true };
  }

  private resolvePublicBaseUrl(request: FastifyRequest): string {
    const forwardedProto = cleanText(request.headers['x-forwarded-proto']);
    const forwardedHost = cleanText(request.headers['x-forwarded-host']);
    const host = forwardedHost || cleanText(request.headers.host) || '127.0.0.1:7431';
    const proto = forwardedProto || request.protocol || 'http';
    return `${proto}://${host}`;
  }

  private buildOAuthPopupHtml(
    status: 'success' | 'failed',
    accountId?: string,
    email?: string,
  ): string {
    const safeStatus = status === 'success' ? 'success' : 'failed';
    const payload = JSON.stringify({
      source: 'adytum-email-calendar-oauth',
      status: safeStatus,
      accountId: accountId || null,
      email: email || null,
    });
    const message =
      safeStatus === 'success'
        ? `Google account connected${email ? `: ${escapeHtml(email)}` : ''}. You can close this window.`
        : 'Google sign-in failed. You can close this window and retry from Skills.';

    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Adytum Google Auth</title>
    <style>
      body { font-family: Inter, sans-serif; background:#0f1115; color:#f3f6fb; padding:24px; }
      .box { max-width:560px; margin:0 auto; border:1px solid #2a2f3a; border-radius:12px; padding:20px; background:#171a21; }
      .ok { color:#6ee7a8; }
      .err { color:#ff8c8c; }
      p { line-height:1.5; margin:0 0 12px; }
    </style>
  </head>
  <body>
    <div class="box">
      <p class="${safeStatus === 'success' ? 'ok' : 'err'}"><strong>${safeStatus === 'success' ? 'Connected' : 'Failed'}</strong></p>
      <p>${message}</p>
    </div>
    <script>
      (function() {
        const payload = ${payload};
        try {
          if (window.opener && !window.opener.closed) {
            window.opener.postMessage(payload, '*');
          }
        } catch {}
        setTimeout(() => {
          try { window.close(); } catch {}
        }, 1200);
      })();
    </script>
  </body>
</html>`;
  }
}

function cleanText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function cleanUrl(value: unknown): string | null {
  const text = cleanText(value);
  if (!text) return null;
  try {
    const parsed = new URL(text);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
