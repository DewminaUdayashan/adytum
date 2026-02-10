import { resolve, relative, sep } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import type { AccessMode, PermissionEntry } from '@adytum/shared';

export class PathValidator {
  private workspaceRoot: string;
  private whitelist: PermissionEntry[] = [];
  private securityManifestPath: string;

  constructor(workspaceRoot: string, dataPath: string) {
    this.workspaceRoot = resolve(workspaceRoot);
    this.securityManifestPath = resolve(dataPath, 'security.json');
    this.loadWhitelist();
  }

  /**
   * Validate that a path is accessible under current permissions.
   * Returns the resolved absolute path if valid, throws if blocked.
   */
  validate(targetPath: string, operation: 'read' | 'write' = 'read'): string {
    const resolved = resolve(targetPath);

    // Always block known sensitive paths
    if (this.isSensitivePath(resolved)) {
      throw new PathSecurityError(
        `Access denied: "${resolved}" is a protected system path`,
        resolved,
        'sensitive_path',
      );
    }

    // Check if within workspace (always allowed)
    if (resolved.startsWith(this.workspaceRoot + sep) || resolved === this.workspaceRoot) {
      return resolved;
    }

    // Check whitelist
    const permission = this.findPermission(resolved);
    if (!permission) {
      throw new PathSecurityError(
        `Access denied: "${resolved}" is outside workspace and not whitelisted`,
        resolved,
        'outside_workspace',
      );
    }

    // Check access mode
    if (operation === 'write' && permission.mode === 'read_only') {
      throw new PathSecurityError(
        `Write access denied: "${resolved}" is read-only`,
        resolved,
        'read_only',
      );
    }

    // Check expiration for JIT permissions
    if (permission.mode === 'just_in_time' && permission.expiresAt) {
      if (Date.now() > permission.expiresAt) {
        throw new PathSecurityError(
          `Access expired: JIT permission for "${resolved}" has expired`,
          resolved,
          'expired',
        );
      }
    }

    return resolved;
  }

  private findPermission(targetPath: string): PermissionEntry | undefined {
    return this.whitelist.find((entry) => {
      const entryPath = resolve(entry.path);
      return targetPath.startsWith(entryPath + sep) || targetPath === entryPath;
    });
  }

  private isSensitivePath(p: string): boolean {
    const sensitive = [
      '/etc/shadow', '/etc/passwd', '/etc/sudoers',
      '/root', '/private/etc',
      '.ssh', '.gnupg', '.aws/credentials',
    ];
    const lower = p.toLowerCase();
    return sensitive.some((s) => lower.includes(s));
  }

  loadWhitelist(): void {
    if (existsSync(this.securityManifestPath)) {
      try {
        const raw = readFileSync(this.securityManifestPath, 'utf-8');
        const data = JSON.parse(raw);
        this.whitelist = Array.isArray(data.permissions) ? data.permissions : [];
      } catch {
        this.whitelist = [];
      }
    }
  }

  addPermission(entry: PermissionEntry): void {
    this.whitelist.push(entry);
    this.saveWhitelist();
  }

  removePermission(path: string): void {
    this.whitelist = this.whitelist.filter((e) => resolve(e.path) !== resolve(path));
    this.saveWhitelist();
  }

  getPermissions(): PermissionEntry[] {
    return [...this.whitelist];
  }

  private saveWhitelist(): void {
    const { writeFileSync, mkdirSync } = require('node:fs');
    const { dirname } = require('node:path');
    mkdirSync(dirname(this.securityManifestPath), { recursive: true });
    writeFileSync(
      this.securityManifestPath,
      JSON.stringify({ permissions: this.whitelist }, null, 2),
      'utf-8',
    );
  }
}

export class PathSecurityError extends Error {
  constructor(
    message: string,
    public readonly blockedPath: string,
    public readonly reason: string,
  ) {
    super(message);
    this.name = 'PathSecurityError';
  }
}
