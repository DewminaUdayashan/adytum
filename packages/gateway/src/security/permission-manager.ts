import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import type { PermissionEntry, AccessMode } from '@adytum/shared';
import { PathValidator } from './path-validator.js';
import { auditLogger } from './audit-logger.js';

/**
 * Manages dynamic file system permissions.
 * Hot-reloads security.json when permissions change.
 */
export class PermissionManager {
  private validator: PathValidator;
  private watchInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private workspacePath: string,
    private dataPath: string,
  ) {
    this.validator = new PathValidator(workspacePath, dataPath);
  }

  /** Validate a path for access. Returns resolved path or throws. */
  validatePath(targetPath: string, operation: 'read' | 'write' = 'read'): string {
    try {
      return this.validator.validate(targetPath, operation);
    } catch (error: any) {
      // Log the security event
      auditLogger.logSecurityEvent({
        action: `${operation}_blocked`,
        blockedPath: targetPath,
        reason: error.reason || error.message,
        agentId: 'primary',
      });
      throw error;
    }
  }

  /** Grant access to a path with a specific mode. */
  grantAccess(path: string, mode: AccessMode, durationMs?: number): void {
    const entry: PermissionEntry = {
      path: resolve(path),
      mode,
      grantedAt: Date.now(),
      expiresAt: durationMs ? Date.now() + durationMs : undefined,
    };

    this.validator.addPermission(entry);

    auditLogger.log({
      traceId: 'system',
      actionType: 'security_event',
      payload: { action: 'permission_granted', path: entry.path, mode },
      status: 'success',
    });
  }

  /** Revoke access to a path. */
  revokeAccess(path: string): void {
    this.validator.removePermission(path);

    auditLogger.log({
      traceId: 'system',
      actionType: 'security_event',
      payload: { action: 'permission_revoked', path: resolve(path) },
      status: 'success',
    });
  }

  /** Get all current permissions. */
  getPermissions(): PermissionEntry[] {
    return this.validator.getPermissions();
  }

  /** Start hot-reload watching. */
  startWatching(intervalMs: number = 5000): void {
    this.watchInterval = setInterval(() => {
      this.validator.loadWhitelist();
    }, intervalMs);
  }

  /** Stop hot-reload watching. */
  stopWatching(): void {
    if (this.watchInterval) {
      clearInterval(this.watchInterval);
      this.watchInterval = null;
    }
  }
}
