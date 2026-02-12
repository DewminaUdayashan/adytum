import { resolve, relative, sep, basename } from 'node:path';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import type { AccessMode, PermissionEntry } from '@adytum/shared';

export class PathValidator {
  private workspaceRoot: string;
  private whitelist: PermissionEntry[] = [];
  private securityManifestPath: string;
  // Critical files that cannot be written to, even if they are in the workspace/data path
  private criticalFiles = [
    'adytum.config.yaml',
    'litellm_config.yaml',
    '.env',
    'security.json',
    'package.json',
  ];

  constructor(workspaceRoot: string, dataPath: string) {
    this.workspaceRoot = resolve(workspaceRoot);
    this.securityManifestPath = resolve(dataPath, 'security.json');
    this.criticalFiles.push(this.securityManifestPath); // explicit absolute path
    this.loadWhitelist();
  }

  /**
   * Validate that a path is accessible under current permissions.
   * Returns the resolved absolute path if valid, throws if blocked.
   */
  validate(targetPath: string, operation: 'read' | 'write' = 'read'): string {
    // 1. Resolve relative paths against workspace root
    let resolved = resolve(this.workspaceRoot, targetPath);

    // 2. Resolve Symlinks (REALPATH check)
    // We try to get the real path. If file doesn't exist, we resolve the parent's real path.
    // This prevents "ln -s /etc/passwd ./passwd" attacks.
    if (existsSync(resolved)) {
      try {
        resolved = realpathSync(resolved);
      } catch (err) {
        throw new PathSecurityError(
          `Access denied: Could not check real path of "${resolved}"`,
          resolved,
          'realpath_failed',
        );
      }
    } else {
      // For new files, check the parent directory
      const parent = resolve(resolved, '..');
      if (existsSync(parent)) {
        try {
          const realParent = realpathSync(parent);
          resolved = resolve(realParent, basename(resolved));
        } catch {
           // Parent might be restricted or invalid, let specific checks handle it
        }
      }
    }

    // 3. Blacklist Check (Critical Config Files)
    // We block writing to these files to prevent privilege escalation or breaking the agent.
    if (this.isCriticalPath(resolved) && operation === 'write') {
        throw new PathSecurityError(
            `Access denied: "${basename(resolved)}" is a critical system file and cannot be modified.`,
            resolved,
            'critical_file'
        );
    }

    // 4. Sensitive System Path Check
    if (this.isSensitivePath(resolved)) {
      throw new PathSecurityError(
        `Access denied: "${resolved}" is a protected system path`,
        resolved,
        'sensitive_path',
      );
    }

    // 5. Workspace Sandbox Check
    // Must be INSIDE the workspace root (not just starting with it string-wise, though resolve handles that)
    if (resolved.startsWith(this.workspaceRoot + sep) || resolved === this.workspaceRoot) {
      return resolved;
    }

    // 6. Whitelist Check
    const permission = this.findPermission(resolved);
    if (!permission) {
      throw new PathSecurityError(
        `Access denied: "${resolved}" is outside workspace and not whitelisted`,
        resolved,
        'outside_workspace',
      );
    }

    // 7. Permission Mode Check
    if (operation === 'write' && permission.mode === 'read_only') {
      throw new PathSecurityError(
        `Write access denied: "${resolved}" is read-only`,
        resolved,
        'read_only',
      );
    }

    // 8. Expiration Check
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

  private isCriticalPath(p: string): boolean {
    const filename = basename(p);
    return this.criticalFiles.includes(filename) || p === this.securityManifestPath;
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
    // We use basic fs imports here to avoid circular dep issues if any
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
