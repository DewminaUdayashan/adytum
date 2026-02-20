/**
 * @file packages/gateway/src/infrastructure/llm/auth-resolver.ts
 * @description Credential resolution chain for model providers.
 *
 * Resolution order (first match wins):
 *   1. Explicit config (adytum.config.yaml modelProviders.providers[x].apiKey)
 *   2. Auth profile store (first healthy credential for provider)
 *   3. Environment variables (PROVIDER_API_KEY)
 *   4. Fallback to undefined (provider may not need auth)
 *
 * Inspired by OpenClaw's model-auth.ts resolution chain pattern.
 */

import type { ModelProviderAuthMode } from '@adytum/shared';
import { AuthStore, type AuthCredential } from './auth-store.js';
import { resolveEnvApiKey, resolveApiKeyValue } from './provider-env-resolver.js';
import type { ProviderBuilderId } from './provider-builders.js';

// ─── Types ────────────────────────────────────────────────────

export interface ResolvedAuth {
  /** The resolved secret (API key, token, etc.) */
  secret: string;
  /** How the credential was obtained */
  source: 'config' | 'profile' | 'env' | 'none';
  /** Auth mode to use */
  mode: ModelProviderAuthMode;
  /** Source details for logging */
  sourceDetail: string;
  /** Whether this credential has been verified */
  verified: boolean;
}

export interface AuthResolverOptions {
  /** Workspace path for auth store location */
  workspacePath: string;
  /** Active auth profile label (default: "default") */
  activeProfile?: string;
  /** Auth store passphrase override */
  passphrase?: string;
}

// ─── Auth Resolver ────────────────────────────────────────────

export class AuthResolver {
  private store: AuthStore;
  private activeProfile: string;
  private cache = new Map<string, ResolvedAuth>();

  constructor(options: AuthResolverOptions) {
    this.store = new AuthStore(options.workspacePath, options.passphrase);
    this.activeProfile = options.activeProfile ?? 'default';
    this.store.load();
  }

  /**
   * Resolve credentials for a provider using the full resolution chain.
   *
   * @param provider - Provider ID (e.g. "anthropic", "openai")
   * @param configApiKey - API key from explicit config (may be literal or env var name)
   * @param configAuthMode - Auth mode from config (default: "api-key")
   */
  resolve(
    provider: string,
    configApiKey?: string,
    configAuthMode: ModelProviderAuthMode = 'api-key',
  ): ResolvedAuth | null {
    // Check cache first
    const cacheKey = `${provider}:${configApiKey ?? ''}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    let result: ResolvedAuth | null = null;

    // 1. Explicit config value
    if (configApiKey) {
      const resolved = resolveApiKeyValue(configApiKey);
      if (resolved) {
        result = {
          secret: resolved,
          source: 'config',
          mode: configAuthMode,
          sourceDetail:
            configApiKey.startsWith('$') || /^[A-Z][A-Z0-9_]*$/.test(configApiKey)
              ? `config (via ${configApiKey})`
              : 'config (literal)',
          verified: false,
        };
      }
    }

    // 2. Auth profile store
    if (!result) {
      const profileCred = this.store.getCredential(this.activeProfile, provider);
      if (profileCred?.secret && profileCred.healthy) {
        result = {
          secret: profileCred.secret,
          source: 'profile',
          mode: profileCred.mode,
          sourceDetail: `profile:${this.activeProfile}`,
          verified: !!profileCred.lastVerified,
        };
      }
    }

    // 3. Fallback: search all profiles for any healthy credential
    if (!result) {
      const anyCred = this.store.findHealthyCredential(provider);
      if (anyCred?.secret) {
        result = {
          secret: anyCred.secret,
          source: 'profile',
          mode: anyCred.mode,
          sourceDetail: 'profile:any',
          verified: !!anyCred.lastVerified,
        };
      }
    }

    // 4. Environment variables
    if (!result) {
      const envKey = resolveEnvApiKey(provider as ProviderBuilderId);
      if (envKey) {
        result = {
          secret: envKey.value,
          source: 'env',
          mode: configAuthMode,
          sourceDetail: `env:${envKey.envVar}`,
          verified: false,
        };
      }
    }

    // Cache the result
    if (result) {
      this.cache.set(cacheKey, result);
    }

    return result;
  }

  /**
   * Store a credential in the active profile.
   */
  storeCredential(provider: string, credential: Omit<AuthCredential, 'healthy'>): void {
    this.store.setCredential(this.activeProfile, provider, {
      ...credential,
      healthy: true,
    });
    // Invalidate cache for this provider
    this.invalidateCache(provider);
  }

  /**
   * Mark a provider's credential as unhealthy after an auth failure.
   * This will cause the resolver to skip it next time and try alternatives.
   */
  markFailed(provider: string): void {
    this.store.markUnhealthy(this.activeProfile, provider);
    this.invalidateCache(provider);
  }

  /**
   * Mark a provider's credential as verified working.
   */
  markVerified(provider: string): void {
    this.store.markHealthy(this.activeProfile, provider);
    this.invalidateCache(provider);
  }

  /**
   * Clear the resolution cache (e.g. after config reload).
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get the underlying auth store for direct access.
   */
  getStore(): AuthStore {
    return this.store;
  }

  /**
   * Switch to a different auth profile.
   */
  setActiveProfile(label: string): void {
    this.activeProfile = label;
    this.cache.clear();
  }

  private invalidateCache(provider: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${provider}:`)) {
        this.cache.delete(key);
      }
    }
  }
}
