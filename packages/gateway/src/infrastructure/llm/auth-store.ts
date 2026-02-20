/**
 * @file packages/gateway/src/infrastructure/llm/auth-store.ts
 * @description Persistent auth profile store for model provider credentials.
 *
 * Profiles are stored encrypted at rest (AES-256-GCM) and identified by a
 * human-readable label. Each profile can hold credentials for one or more
 * providers, with automatic rotation and expiry tracking.
 *
 * Inspired by OpenClaw's auth-profiles + credential-cache pattern.
 */

import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import type { ModelProviderAuthMode } from '@adytum/shared';

// ─── Types ────────────────────────────────────────────────────

export interface AuthCredential {
  /** The provider this credential is for */
  provider: string;
  /** Authentication mode */
  mode: ModelProviderAuthMode;
  /** API key, OAuth token, or bearer token value */
  secret: string;
  /** Where this credential came from */
  source: 'env' | 'profile' | 'config' | 'oauth';
  /** Env var name (if source is 'env') */
  envVar?: string;
  /** When this credential expires (ISO 8601), if applicable */
  expiresAt?: string;
  /** Last time this credential was verified working */
  lastVerified?: string;
  /** Whether this credential is currently known to be working */
  healthy: boolean;
}

export interface AuthProfile {
  /** Profile label (e.g. "personal", "work", "ci") */
  label: string;
  /** When this profile was created */
  createdAt: string;
  /** When this profile was last modified */
  updatedAt: string;
  /** Provider credentials */
  credentials: Record<string, AuthCredential>;
}

interface EncryptedStore {
  version: 1;
  /** Salt for key derivation */
  salt: string;
  /** Initialization vector */
  iv: string;
  /** AES-256-GCM auth tag */
  tag: string;
  /** Encrypted JSON payload */
  data: string;
}

// ─── Encryption Helpers ───────────────────────────────────────

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const SALT_LENGTH = 32;

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, KEY_LENGTH);
}

function encrypt(plaintext: string, passphrase: string): EncryptedStore {
  const salt = randomBytes(SALT_LENGTH);
  const key = deriveKey(passphrase, salt);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag();

  return {
    version: 1,
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    data: encrypted,
  };
}

function decrypt(store: EncryptedStore, passphrase: string): string {
  const salt = Buffer.from(store.salt, 'hex');
  const key = deriveKey(passphrase, salt);
  const iv = Buffer.from(store.iv, 'hex');
  const tag = Buffer.from(store.tag, 'hex');
  const decipher = createDecipheriv(ALGORITHM, key, iv);

  decipher.setAuthTag(tag);
  let decrypted = decipher.update(store.data, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

// ─── Auth Store ───────────────────────────────────────────────

/**
 * Manages encrypted credential profiles on disk.
 *
 * The store passphrase defaults to the `ADYTUM_AUTH_SECRET` env var.
 * If not set, credentials are stored in plaintext (development mode).
 */
export class AuthStore {
  private profiles: Map<string, AuthProfile> = new Map();
  private storePath: string;
  private passphrase: string | null;
  private loaded = false;

  constructor(workspacePath: string, passphrase?: string) {
    const authDir = join(workspacePath, '.adytum', 'auth');
    if (!existsSync(authDir)) {
      mkdirSync(authDir, { recursive: true });
    }
    this.storePath = join(authDir, 'profiles.enc');
    this.passphrase = passphrase ?? process.env.ADYTUM_AUTH_SECRET ?? null;
  }

  /**
   * Load profiles from disk.
   */
  load(): void {
    if (!existsSync(this.storePath)) {
      this.loaded = true;
      return;
    }

    try {
      const raw = readFileSync(this.storePath, 'utf8');

      if (this.passphrase) {
        // Encrypted store
        const store = JSON.parse(raw) as EncryptedStore;
        const decrypted = decrypt(store, this.passphrase);
        const data = JSON.parse(decrypted) as Record<string, AuthProfile>;
        this.profiles = new Map(Object.entries(data));
      } else {
        // Plaintext fallback (dev mode)
        const data = JSON.parse(raw) as Record<string, AuthProfile>;
        this.profiles = new Map(Object.entries(data));
      }

      this.loaded = true;
    } catch {
      // Corrupted or wrong passphrase — start fresh
      this.profiles = new Map();
      this.loaded = true;
    }
  }

  /**
   * Save profiles to disk.
   */
  save(): void {
    const data = Object.fromEntries(this.profiles);
    const json = JSON.stringify(data, null, 2);

    if (this.passphrase) {
      const encrypted = encrypt(json, this.passphrase);
      writeFileSync(this.storePath, JSON.stringify(encrypted), 'utf8');
    } else {
      writeFileSync(this.storePath, json, 'utf8');
    }
  }

  /**
   * Get or create a profile by label.
   */
  getProfile(label: string): AuthProfile {
    if (!this.loaded) this.load();

    const existing = this.profiles.get(label);
    if (existing) return existing;

    const profile: AuthProfile = {
      label,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      credentials: {},
    };
    this.profiles.set(label, profile);
    return profile;
  }

  /**
   * Set a credential for a provider in a profile.
   */
  setCredential(profileLabel: string, provider: string, credential: AuthCredential): void {
    const profile = this.getProfile(profileLabel);
    profile.credentials[provider] = credential;
    profile.updatedAt = new Date().toISOString();
    this.save();
  }

  /**
   * Get a credential for a provider from a specific profile.
   */
  getCredential(profileLabel: string, provider: string): AuthCredential | undefined {
    if (!this.loaded) this.load();
    return this.profiles.get(profileLabel)?.credentials[provider];
  }

  /**
   * Remove a provider's credential from a profile.
   */
  removeCredential(profileLabel: string, provider: string): boolean {
    if (!this.loaded) this.load();
    const profile = this.profiles.get(profileLabel);
    if (!profile?.credentials[provider]) return false;
    delete profile.credentials[provider];
    profile.updatedAt = new Date().toISOString();
    this.save();
    return true;
  }

  /**
   * List all profile labels.
   */
  listProfiles(): string[] {
    if (!this.loaded) this.load();
    return Array.from(this.profiles.keys());
  }

  /**
   * Delete an entire profile.
   */
  deleteProfile(label: string): boolean {
    if (!this.loaded) this.load();
    const deleted = this.profiles.delete(label);
    if (deleted) this.save();
    return deleted;
  }

  /**
   * Find first healthy credential for a provider across all profiles.
   */
  findHealthyCredential(provider: string): AuthCredential | undefined {
    if (!this.loaded) this.load();
    for (const profile of this.profiles.values()) {
      const cred = profile.credentials[provider];
      if (cred?.healthy && !this.isExpired(cred)) {
        return cred;
      }
    }
    return undefined;
  }

  /**
   * Mark a credential as unhealthy (e.g., after auth failure).
   */
  markUnhealthy(profileLabel: string, provider: string): void {
    const cred = this.getCredential(profileLabel, provider);
    if (cred) {
      cred.healthy = false;
      this.save();
    }
  }

  /**
   * Mark a credential as verified healthy.
   */
  markHealthy(profileLabel: string, provider: string): void {
    const cred = this.getCredential(profileLabel, provider);
    if (cred) {
      cred.healthy = true;
      cred.lastVerified = new Date().toISOString();
      this.save();
    }
  }

  private isExpired(cred: AuthCredential): boolean {
    if (!cred.expiresAt) return false;
    return new Date(cred.expiresAt) < new Date();
  }
}
