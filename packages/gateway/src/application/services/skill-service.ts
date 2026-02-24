/**
 * @file packages/gateway/src/application/services/skill-service.ts
 * @description Implements application-level service logic and coordination.
 */

import { randomBytes, createHash } from 'node:crypto';
import { relative, join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { singleton, inject } from 'tsyringe';
import { Logger } from '../../logger.js';
import { loadConfig, saveConfig } from '../../config.js';
import { SkillLoader, type LoadedSkill as Skill } from '../services/skill-loader.js';
import { SecretsStore } from '../../security/secrets-store.js';
import type { AdytumConfig } from '@adytum/shared';

const EMAIL_CALENDAR_SKILL_ID = 'email-calendar';
const EMAIL_CALENDAR_SECRETS_KEY = 'ADYTUM_EMAIL_CALENDAR_ACCOUNTS_JSON';
const OAUTH_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
];

type AccountProvider = 'google';

type EmailCalendarSkillConfig = {
  clientId?: string;
  clientSecret?: string;
  tokenUrl?: string;
  [key: string]: unknown;
};

type StoredAccountSecret = {
  provider: AccountProvider;
  label?: string;
  refreshToken?: string;
  accessToken?: string;
  expiresAt?: number;
  scope?: string;
  tokenType?: string;
  email?: string;
  connectedAt?: string;
  updatedAt?: string;
};

type StoredAccountsPayload = {
  accounts: Record<string, StoredAccountSecret>;
};

type OAuthStartInput = {
  accountId?: string;
  label?: string;
  loginHint?: string;
  callbackBaseUrl: string;
};

type PendingOAuthAttempt = {
  state: string;
  accountId: string;
  label?: string;
  redirectUri: string;
  codeVerifier: string;
  createdAtMs: number;
  expiresAtMs: number;
  status: 'pending' | 'success' | 'failed';
  error?: string;
  errorDescription?: string;
  connectedEmail?: string;
};

type OAuthCallbackInput = {
  state?: string;
  code?: string;
  error?: string;
  errorDescription?: string;
};

type OAuthStatusOutput = {
  state: string;
  status: 'pending' | 'success' | 'failed' | 'expired' | 'unknown';
  accountId?: string;
  connectedEmail?: string;
  error?: string;
  errorDescription?: string;
  expiresAtMs?: number;
};

type OAuthAccountsOutput = {
  canStartAuth: boolean;
  missingClientConfig: string[];
  accounts: Array<{
    id: string;
    label: string;
    email?: string;
    provider: AccountProvider;
    connected: boolean;
    hasRefreshToken: boolean;
    connectedAt?: string;
    updatedAt?: string;
  }>;
};

type OAuthStartOutput = {
  state: string;
  accountId: string;
  authorizationUrl: string;
  expiresAtMs: number;
};

/**
 * Encapsulates skill service behavior.
 */
@singleton()
export class SkillService {
  private onReloadCallback: (() => Promise<void>) | null = null;
  private oauthAttempts = new Map<string, PendingOAuthAttempt>();

  constructor(
    @inject(Logger) private logger: Logger,
    @inject(SkillLoader) private loader: SkillLoader,
    @inject(SecretsStore) private secretsStore: SecretsStore,
  ) {}

  /**
   * Sets reload callback.
   * @param cb - Cb.
   */
  public setReloadCallback(cb: () => Promise<void>) {
    this.onReloadCallback = cb;
  }

  /**
   * Retrieves all skills.
   * @returns The resulting collection of values.
   */
  public getAllSkills(): Skill[] {
    return this.loader.getAll();
  }

  /**
   * Removes legacy email-calendar config fields that are no longer valid in schema.
   */
  public async migrateEmailCalendarLegacyConfig(): Promise<void> {
    await this.sanitizeEmailCalendarLegacyConfigIfNeeded();
  }

  /**
   * Retrieves skill.
   * @param id - Id.
   * @returns The get skill result.
   */
  public getSkill(id: string): Skill | undefined {
    return this.loader?.getAll().find((s) => s.id === id);
  }

  /**
   * Retrieves skill secret keys.
   * @param id - Skill id.
   * @returns The skill secret keys.
   */
  public getSkillSecretKeys(id: string): string[] {
    return this.secretsStore.listSkillKeys(id);
  }

  /**
   * Retrieves skill instructions.
   * @param id - Id.
   */
  public getSkillInstructions(id: string) {
    const skill = this.getSkill(id);
    if (!skill) return null;

    const files = skill.instructionFiles.map((fullPath) => {
      const rel = relative(skill.path, fullPath);
      let content = '';
      try {
        content = readFileSync(fullPath, 'utf-8');
      } catch (err) {
        this.logger.error(`Failed to read instruction file: ${fullPath}`, err);
      }
      return {
        path: fullPath,
        relativePath: rel,
        content,
        editable: !skill.readonly,
      };
    });

    return {
      files,
      combined: skill.instructions,
    };
  }

  /**
   * Executes update skill instructions.
   * @param id - Id.
   * @param relativePath - Relative path.
   * @param content - Content.
   */
  public async updateSkillInstructions(
    id: string,
    relativePath: string,
    content: string,
  ): Promise<void> {
    const skill = this.getSkill(id);
    if (!skill) throw new Error(`Skill ${id} not found`);
    if (skill.readonly) throw new Error(`Skill ${id} is read-only`);

    const fullPath = join(skill.path, relativePath);
    if (!fullPath.startsWith(skill.path)) {
      throw new Error('Invalid instruction path');
    }

    writeFileSync(fullPath, content, 'utf-8');
    this.logger.debug(`Updated instructions for skill ${id}: ${relativePath}`);
    await this.reloadSkills();
  }

  /**
   * Executes update skill.
   * @param id - Id.
   * @param data - Data.
   */
  public async updateSkill(
    id: string,
    data: { enabled?: boolean; config?: Record<string, unknown>; installPermission?: string },
  ): Promise<void> {
    const config = loadConfig();
    const skills = config.skills || { enabled: true, entries: {}, allow: [], deny: [] };
    const entries = skills.entries || {};
    const entry = entries[id] || {};

    if (data.enabled !== undefined) entry.enabled = data.enabled;
    if (data.config !== undefined) entry.config = data.config;
    if (data.installPermission !== undefined)
      entry.installPermission = data.installPermission as 'auto' | 'ask' | 'deny';

    entries[id] = entry;
    saveConfig({
      skills: { ...skills, entries } as unknown as AdytumConfig['skills'],
    });
    this.logger.debug(`Updated config for skill ${id}`);
    await this.reloadSkills();
  }

  /**
   * Sets skill secrets.
   * @param id - Id.
   * @param secrets - Secrets.
   */
  public async setSkillSecrets(id: string, secrets: Record<string, string>): Promise<void> {
    for (const [key, value] of Object.entries(secrets || {})) {
      const cleaned = value?.trim();
      if (!cleaned) continue;
      this.secretsStore.setSkillSecret(id, key, cleaned);
    }
    this.loader.setSkillSecrets(id, this.secretsStore.getSkillEnv(id));
    this.logger.debug(`Updated secrets for skill ${id}`);
    await this.reloadSkills();
  }

  /**
   * Starts Google OAuth flow for email-calendar.
   * @param input - OAuth start input.
   * @returns OAuth start output.
   */
  public async startEmailCalendarGoogleOAuth(input: OAuthStartInput): Promise<OAuthStartOutput> {
    await this.sanitizeEmailCalendarLegacyConfigIfNeeded();
    const { clientId, missingClientConfig } = this.resolveEmailCalendarOAuthConfig();
    if (!clientId || missingClientConfig.length > 0) {
      throw new Error(
        `Google OAuth is not configured. Missing: ${missingClientConfig.join(', ')}. Configure from dashboard or env.`,
      );
    }

    const label = cleanText(input.label);
    if (!label) {
      throw new Error('Account label is required (example: work, personal).');
    }
    const accountId = normalizeAccountId(input.accountId) || normalizeAccountId(label);
    if (!accountId) {
      throw new Error('Unable to derive account id from label.');
    }

    const existingAccounts = this.getEmailCalendarStoredAccounts().accounts;
    const duplicateLabel = Object.entries(existingAccounts).find(([id, entry]) => {
      const existingLabel = cleanText(entry.label);
      if (!existingLabel) return false;
      return id !== accountId && existingLabel.toLowerCase() === label.toLowerCase();
    });
    if (duplicateLabel) {
      throw new Error(`Account label "${label}" is already in use. Choose a unique label.`);
    }

    const state = randomBytes(16).toString('hex');
    const codeVerifier = toBase64Url(randomBytes(48));
    const codeChallenge = toBase64Url(createHash('sha256').update(codeVerifier).digest());
    const redirectUri = `${stripTrailingSlash(input.callbackBaseUrl)}/api/skills/${EMAIL_CALENDAR_SKILL_ID}/oauth/google/callback`;
    const now = Date.now();
    const expiresAtMs = now + 10 * 60 * 1000;

    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('access_type', 'offline');
    authUrl.searchParams.set('include_granted_scopes', 'true');
    authUrl.searchParams.set('prompt', 'consent');
    authUrl.searchParams.set('scope', OAUTH_SCOPES.join(' '));
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    if (input.loginHint?.trim()) {
      authUrl.searchParams.set('login_hint', input.loginHint.trim());
    }

    this.oauthAttempts.set(state, {
      state,
      accountId,
      label: label || undefined,
      redirectUri,
      codeVerifier,
      createdAtMs: now,
      expiresAtMs,
      status: 'pending',
    });
    this.cleanupOAuthAttempts();

    return {
      state,
      accountId,
      authorizationUrl: authUrl.toString(),
      expiresAtMs,
    };
  }

  /**
   * Handles Google OAuth callback for email-calendar.
   * @param input - Callback payload.
   */
  public async handleEmailCalendarGoogleOAuthCallback(
    input: OAuthCallbackInput,
  ): Promise<{ state: string; status: 'success' | 'failed'; accountId?: string; email?: string }> {
    await this.sanitizeEmailCalendarLegacyConfigIfNeeded();
    this.cleanupOAuthAttempts();
    const state = cleanText(input.state);
    if (!state) {
      throw new Error('Missing OAuth state.');
    }

    const attempt = this.oauthAttempts.get(state);
    if (!attempt) {
      throw new Error('OAuth session not found or expired.');
    }
    if (attempt.expiresAtMs <= Date.now()) {
      attempt.status = 'failed';
      attempt.error = 'expired';
      attempt.errorDescription = 'OAuth session expired. Start again.';
      return { state, status: 'failed' };
    }

    if (input.error) {
      attempt.status = 'failed';
      attempt.error = cleanText(input.error) || 'oauth_error';
      attempt.errorDescription = cleanText(input.errorDescription) || undefined;
      return {
        state,
        status: 'failed',
        accountId: attempt.accountId,
      };
    }

    if (!input.code) {
      attempt.status = 'failed';
      attempt.error = 'missing_code';
      attempt.errorDescription = 'Authorization code was not returned by Google.';
      return {
        state,
        status: 'failed',
        accountId: attempt.accountId,
      };
    }

    const { clientId, clientSecret, tokenUrl } = this.resolveEmailCalendarOAuthConfig();
    if (!clientId) {
      attempt.status = 'failed';
      attempt.error = 'missing_client_id';
      attempt.errorDescription = 'OAuth client ID is not configured.';
      return { state, status: 'failed', accountId: attempt.accountId };
    }

    try {
      const tokenResponse = await this.exchangeGoogleAuthorizationCode({
        tokenUrl,
        clientId,
        clientSecret,
        code: input.code,
        redirectUri: attempt.redirectUri,
        codeVerifier: attempt.codeVerifier,
      });

      const nowIso = new Date().toISOString();
      const emailFromProfile = await this.fetchGoogleUserEmail(tokenResponse.access_token);
      const accountEmail = emailFromProfile || attempt.label || undefined;

      const secretsPayload = this.getEmailCalendarStoredAccounts();
      const prevSecret = secretsPayload.accounts[attempt.accountId];
      secretsPayload.accounts[attempt.accountId] = {
        provider: 'google',
        label: attempt.label || prevSecret?.label || accountEmail || attempt.accountId,
        refreshToken: tokenResponse.refresh_token || prevSecret?.refreshToken,
        accessToken: tokenResponse.access_token || prevSecret?.accessToken,
        expiresAt:
          typeof tokenResponse.expires_in === 'number'
            ? Date.now() + tokenResponse.expires_in * 1000
            : prevSecret?.expiresAt,
        scope: tokenResponse.scope || prevSecret?.scope,
        tokenType: tokenResponse.token_type || prevSecret?.tokenType,
        email: accountEmail || prevSecret?.email,
        connectedAt: prevSecret?.connectedAt || nowIso,
        updatedAt: nowIso,
      };
      this.persistEmailCalendarStoredAccounts(secretsPayload);

      attempt.status = 'success';
      attempt.connectedEmail = accountEmail;

      this.loader.setSkillSecrets(
        EMAIL_CALENDAR_SKILL_ID,
        this.secretsStore.getSkillEnv(EMAIL_CALENDAR_SKILL_ID),
      );
      await this.reloadSkills();

      return {
        state,
        status: 'success',
        accountId: attempt.accountId,
        email: accountEmail || undefined,
      };
    } catch (error: unknown) {
      attempt.status = 'failed';
      attempt.error = 'oauth_exchange_failed';
      attempt.errorDescription = errorMessage(error);
      return {
        state,
        status: 'failed',
        accountId: attempt.accountId,
      };
    }
  }

  /**
   * Gets OAuth status by state.
   * @param state - OAuth state.
   * @returns OAuth status.
   */
  public getEmailCalendarGoogleOAuthStatus(state: string): OAuthStatusOutput {
    this.cleanupOAuthAttempts();
    const cleanedState = cleanText(state);
    if (!cleanedState) {
      return { state: '', status: 'unknown', error: 'missing_state' };
    }

    const attempt = this.oauthAttempts.get(cleanedState);
    if (!attempt) {
      return { state: cleanedState, status: 'expired', error: 'not_found_or_expired' };
    }
    return {
      state: cleanedState,
      status: attempt.status,
      accountId: attempt.accountId,
      connectedEmail: attempt.connectedEmail,
      error: attempt.error,
      errorDescription: attempt.errorDescription,
      expiresAtMs: attempt.expiresAtMs,
    };
  }

  /**
   * Lists connected OAuth accounts for email-calendar.
   * @returns Account summary for dashboard.
   */
  public async listEmailCalendarGoogleOAuthAccounts(): Promise<OAuthAccountsOutput> {
    await this.sanitizeEmailCalendarLegacyConfigIfNeeded();
    const { clientId, missingClientConfig } = this.resolveEmailCalendarOAuthConfig();
    const accountSecrets = this.getEmailCalendarStoredAccounts().accounts;
    const accounts = Object.entries(accountSecrets)
      .map(([id, secret]) => {
        const connected = Boolean(secret?.refreshToken || secret?.accessToken);
        return {
          id,
          label: secret?.label || secret?.email || id,
          email: secret?.email,
          provider: 'google' as const,
          connected,
          hasRefreshToken: Boolean(secret?.refreshToken),
          connectedAt: secret?.connectedAt,
          updatedAt: secret?.updatedAt,
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));

    return {
      canStartAuth: Boolean(clientId) && missingClientConfig.length === 0,
      missingClientConfig,
      accounts,
    };
  }

  /**
   * Removes account from email-calendar config and secrets.
   * @param accountId - Account id.
   */
  public async removeEmailCalendarAccount(accountId: string): Promise<void> {
    await this.sanitizeEmailCalendarLegacyConfigIfNeeded();
    const normalized = normalizeAccountId(accountId);
    if (!normalized) throw new Error('accountId is required.');

    const secretsPayload = this.getEmailCalendarStoredAccounts();
    delete secretsPayload.accounts[normalized];
    this.persistEmailCalendarStoredAccounts(secretsPayload);

    this.loader.setSkillSecrets(
      EMAIL_CALENDAR_SKILL_ID,
      this.secretsStore.getSkillEnv(EMAIL_CALENDAR_SKILL_ID),
    );
    await this.reloadSkills();
  }

  /**
   * Retrieves WhatsApp status.
   * @returns WhatsApp status.
   */
  public getWhatsAppStatus() {
    const service = this.loader.getService('whatsapp-service');
    if (!service || typeof (service as any).getStatus !== 'function') {
      return { status: 'disconnected', qr: null };
    }
    return (service as any).getStatus();
  }

  /**
   * Executes reload skills.
   */
  public async reloadSkills(): Promise<void> {
    if (this.onReloadCallback) {
      await this.onReloadCallback();
    }
  }

  private resolveEmailCalendarOAuthConfig(): {
    skillConfig: EmailCalendarSkillConfig;
    clientId: string | null;
    clientSecret: string | null;
    tokenUrl: string;
    missingClientConfig: string[];
  } {
    const skillConfig = this.getEmailCalendarSkillConfig();
    const clientId =
      cleanText(skillConfig.clientId) || cleanText(process.env.ADYTUM_GOOGLE_OAUTH_CLIENT_ID);
    const clientSecret =
      cleanText(skillConfig.clientSecret) ||
      cleanText(process.env.ADYTUM_GOOGLE_OAUTH_CLIENT_SECRET);
    const tokenUrl = cleanText(skillConfig.tokenUrl) || 'https://oauth2.googleapis.com/token';
    const missingClientConfig: string[] = [];
    if (!clientId) missingClientConfig.push('clientId');
    return {
      skillConfig,
      clientId: clientId || null,
      clientSecret: clientSecret || null,
      tokenUrl,
      missingClientConfig,
    };
  }

  private getEmailCalendarSkillConfig(): EmailCalendarSkillConfig {
    const config = loadConfig();
    const raw = config.skills?.entries?.[EMAIL_CALENDAR_SKILL_ID]?.config;
    if (!isRecord(raw)) return {};
    return { ...raw } as EmailCalendarSkillConfig;
  }

  private updateEmailCalendarSkillConfig(nextConfig: EmailCalendarSkillConfig): void {
    const full = loadConfig();
    const skills = full.skills || { enabled: true, entries: {}, allow: [], deny: [] };
    const entries = { ...(skills.entries || {}) };
    const entry = { ...(entries[EMAIL_CALENDAR_SKILL_ID] || {}) };
    entry.config = nextConfig;
    entries[EMAIL_CALENDAR_SKILL_ID] = entry;
    saveConfig({
      skills: { ...skills, entries } as unknown as AdytumConfig['skills'],
    });
  }

  private async sanitizeEmailCalendarLegacyConfigIfNeeded(): Promise<void> {
    const current = this.getEmailCalendarSkillConfig();
    const mutable = { ...current } as Record<string, unknown>;
    let changed = false;
    if ('accounts' in mutable) {
      delete mutable.accounts;
      changed = true;
    }
    if ('activeAccountId' in mutable) {
      delete mutable.activeAccountId;
      changed = true;
    }
    if (!changed) return;

    this.updateEmailCalendarSkillConfig(mutable as EmailCalendarSkillConfig);
    this.logger.debug('Removed legacy email-calendar config fields (accounts, activeAccountId).');
    await this.reloadSkills();
  }

  private getEmailCalendarStoredAccounts(): StoredAccountsPayload {
    const env = this.secretsStore.getSkillEnv(EMAIL_CALENDAR_SKILL_ID);
    const raw = env[EMAIL_CALENDAR_SECRETS_KEY];
    if (!raw) return { accounts: {} };
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!isRecord(parsed)) return { accounts: {} };
      const container = isRecord(parsed.accounts)
        ? (parsed.accounts as Record<string, unknown>)
        : parsed;
      const accounts: Record<string, StoredAccountSecret> = {};
      for (const [id, value] of Object.entries(container)) {
        if (!id.trim() || !isRecord(value)) continue;
        accounts[id] = {
          provider: value.provider === 'google' ? 'google' : 'google',
          label: cleanText(value.label) || undefined,
          refreshToken: cleanText(value.refreshToken) || undefined,
          accessToken: cleanText(value.accessToken) || undefined,
          expiresAt:
            typeof value.expiresAt === 'number' && Number.isFinite(value.expiresAt)
              ? value.expiresAt
              : undefined,
          scope: cleanText(value.scope) || undefined,
          tokenType: cleanText(value.tokenType) || undefined,
          email: cleanText(value.email) || undefined,
          connectedAt: cleanText(value.connectedAt) || undefined,
          updatedAt: cleanText(value.updatedAt) || undefined,
        };
      }
      return { accounts };
    } catch {
      return { accounts: {} };
    }
  }

  private persistEmailCalendarStoredAccounts(payload: StoredAccountsPayload): void {
    this.secretsStore.setSkillSecret(
      EMAIL_CALENDAR_SKILL_ID,
      EMAIL_CALENDAR_SECRETS_KEY,
      JSON.stringify(payload),
    );
  }

  private cleanupOAuthAttempts(): void {
    const now = Date.now();
    for (const [state, attempt] of this.oauthAttempts.entries()) {
      const staleSuccessful =
        attempt.status !== 'pending' && attempt.expiresAtMs + 5 * 60 * 1000 < now;
      const expiredPending = attempt.status === 'pending' && attempt.expiresAtMs < now;
      if (expiredPending || staleSuccessful) {
        this.oauthAttempts.delete(state);
      }
    }
  }

  private async exchangeGoogleAuthorizationCode(params: {
    tokenUrl: string;
    clientId: string;
    clientSecret: string | null;
    code: string;
    redirectUri: string;
    codeVerifier: string;
  }): Promise<{
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    token_type?: string;
    scope?: string;
  }> {
    const form = new URLSearchParams();
    form.set('grant_type', 'authorization_code');
    form.set('code', params.code);
    form.set('redirect_uri', params.redirectUri);
    form.set('client_id', params.clientId);
    form.set('code_verifier', params.codeVerifier);
    if (params.clientSecret) {
      form.set('client_secret', params.clientSecret);
    }

    const response = await fetch(params.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      const error = cleanText(payload.error) || `oauth_token_http_${response.status}`;
      const description = cleanText(payload.error_description);
      throw new Error(description ? `${error}: ${description}` : error);
    }
    return {
      access_token: cleanText(payload.access_token) || undefined,
      refresh_token: cleanText(payload.refresh_token) || undefined,
      expires_in: typeof payload.expires_in === 'number' ? payload.expires_in : undefined,
      token_type: cleanText(payload.token_type) || undefined,
      scope: cleanText(payload.scope) || undefined,
    };
  }

  private async fetchGoogleUserEmail(accessToken?: string): Promise<string | null> {
    if (!accessToken) return null;
    try {
      const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      if (!response.ok) return null;
      const payload = (await response.json()) as Record<string, unknown>;
      return cleanText(payload.email) || null;
    } catch {
      return null;
    }
  }
}

function cleanText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string' && error.trim()) return error.trim();
  return 'Unknown OAuth error';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeAccountId(value: string | undefined): string | null {
  if (!value) return null;
  const normalized = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || null;
}

function toBase64Url(value: Buffer): string {
  return value.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/g, '');
}
