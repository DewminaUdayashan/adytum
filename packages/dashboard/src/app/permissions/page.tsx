'use client';

/**
 * @file packages/dashboard/src/app/permissions/page.tsx
 * @description Defines route-level UI composition and page behavior.
 */

import { useState, useEffect } from 'react';
import { usePolling } from '@/hooks/use-polling';
import { gatewayFetch } from '@/lib/api';
import { Card, Badge, Spinner, EmptyState, Button, Select } from '@/components/ui';
import { Shield, Plus, Trash2, Clock, Lock, Unlock } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface Permission {
  path: string;
  mode: string;
  grantedAt: number;
  expiresAt?: number;
}

interface PermissionsResponse {
  permissions: Permission[];
}

const MODE_VARIANTS: Record<string, 'success' | 'warning' | 'info' | 'default'> = {
  workspace_only: 'info',
  read_only: 'default',
  full_access: 'success',
  just_in_time: 'warning',
};

const MODE_LABELS: Record<string, string> = {
  workspace_only: 'Workspace Only',
  read_only: 'Read Only',
  full_access: 'Full Access',
  just_in_time: 'Just-in-Time',
};

type ExecutionPermissions = {
  shell: 'auto' | 'ask' | 'deny';
  defaultChannel?: string;
  defaultUser?: string;
  defaultCommSkillId?: string;
  approvalBaseUrl?: string;
};
type SkillsResponse = {
  skills: Array<{ id: string; name: string; communication?: boolean }>;
  global: { permissions?: { install: 'auto' | 'ask' | 'deny'; defaultChannel?: string } };
  execution?: ExecutionPermissions;
};

export default function PermissionsPage() {
  const { data, loading, refresh } = usePolling<PermissionsResponse>('/api/permissions', 5000);
  const [showGrant, setShowGrant] = useState(false);
  const [grantPath, setGrantPath] = useState('');
  const [grantMode, setGrantMode] = useState('read_only');
  const [grantDuration, setGrantDuration] = useState('');
  const [installPerm, setInstallPerm] = useState<'auto' | 'ask' | 'deny'>('ask');
  const [execPerms, setExecPerms] = useState<ExecutionPermissions>({
    shell: 'ask',
    defaultChannel: '',
    defaultUser: '',
    approvalBaseUrl: '',
  });
  const [commSkills, setCommSkills] = useState<Array<{ id: string; name: string }>>([]);

  const permissions = data?.permissions || [];

  useEffect(() => {
    const load = async () => {
      try {
        const skillsRes = await gatewayFetch<SkillsResponse>('/api/skills');
        if (skillsRes.global?.permissions) {
          setInstallPerm(skillsRes.global.permissions.install || 'ask');
        }
        const comm = (skillsRes.skills || [])
          .filter((s) => s.communication)
          .map((s) => ({ id: s.id, name: s.name }));
        setCommSkills(comm);
        if (skillsRes.execution) {
          setExecPerms((prev) => ({
            shell: skillsRes.execution?.shell || prev.shell,
            defaultChannel: skillsRes.execution?.defaultChannel || prev.defaultChannel,
            defaultUser: (skillsRes.execution as any)?.defaultUser || prev.defaultUser,
            defaultCommSkillId: skillsRes.execution?.defaultCommSkillId || prev.defaultCommSkillId,
            approvalBaseUrl: skillsRes.execution?.approvalBaseUrl || prev.approvalBaseUrl,
          }));
        }
      } catch {
        /* ignore */
      }
      try {
        const exec = await gatewayFetch<{ execution: ExecutionPermissions }>(
          '/api/execution/permissions',
        );
        if (exec.execution) {
          setExecPerms({
            shell: exec.execution.shell || 'ask',
            defaultChannel: exec.execution.defaultChannel,
            defaultUser: (exec.execution as any).defaultUser,
            defaultCommSkillId: exec.execution.defaultCommSkillId,
            approvalBaseUrl: exec.execution.approvalBaseUrl,
          });
        }
      } catch {
        /* ignore */
      }
    };
    load();
  }, []);

  const handleGrant = async () => {
    if (!grantPath) return;
    try {
      await gatewayFetch('/api/permissions/grant', {
        method: 'POST',
        body: JSON.stringify({
          path: grantPath,
          mode: grantMode,
          durationMs: grantDuration ? Number(grantDuration) * 60 * 1000 : undefined,
        }),
      });
      setShowGrant(false);
      setGrantPath('');
      setGrantDuration('');
      refresh();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleRevoke = async (path: string) => {
    if (!confirm(`Revoke access to ${path}?`)) return;
    try {
      await gatewayFetch('/api/permissions/revoke', {
        method: 'POST',
        body: JSON.stringify({ path }),
      });
      refresh();
    } catch (err: any) {
      alert(err.message);
    }
  };

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-full">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full animate-fade-in">
      {/* Header */}
      <div className="px-8 pt-8 pb-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-[0.2em] text-text-muted font-medium">
              Security
            </p>
            <h1 className="text-2xl font-semibold text-text-primary tracking-tight mt-1">
              Permissions
            </h1>
          </div>
          <Button variant="primary" size="sm" onClick={() => setShowGrant(!showGrant)}>
            <Plus className="h-3.5 w-3.5" />
            Grant Access
          </Button>
        </div>
      </div>

      <div className="px-8 pb-4">
        <Card>
          <h3 className="text-sm font-semibold text-text-primary mb-3">Agent Settings</h3>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                Install permissions
              </p>
              <Select
                value={installPerm}
                onChange={(val) => setInstallPerm(val as 'auto' | 'ask' | 'deny')}
                options={[
                  { value: 'auto', label: 'Auto' },
                  { value: 'ask', label: 'Ask' },
                  { value: 'deny', label: 'Deny' },
                ]}
                className="w-full"
              />
            </div>
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                Terminal commands
              </p>
              <Select
                value={execPerms.shell}
                onChange={(val) =>
                  setExecPerms((prev) => ({ ...prev, shell: val as 'auto' | 'ask' | 'deny' }))
                }
                options={[
                  { value: 'auto', label: 'Auto' },
                  { value: 'ask', label: 'Ask' },
                  { value: 'deny', label: 'Deny' },
                ]}
                className="w-full"
              />
            </div>
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                Default approval channel
              </p>
              <input
                value={execPerms.defaultChannel || ''}
                onChange={(e) =>
                  setExecPerms((prev) => ({ ...prev, defaultChannel: e.target.value }))
                }
                placeholder="e.g. Discord channel ID"
                className="w-full rounded-lg bg-bg-tertiary border border-border-primary px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-primary/50"
              />
            </div>
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                Default approval user
              </p>
              <input
                value={execPerms.defaultUser || ''}
                onChange={(e) => setExecPerms((prev) => ({ ...prev, defaultUser: e.target.value }))}
                placeholder="e.g. Discord user ID (DM)"
                className="w-full rounded-lg bg-bg-tertiary border border-border-primary px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-primary/50"
              />
              <p className="text-[11px] text-text-tertiary">
                If set, approval notices will also be sent via DM.
              </p>
            </div>
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                Public approval base URL
              </p>
              <input
                value={execPerms.approvalBaseUrl || ''}
                onChange={(e) =>
                  setExecPerms((prev) => ({ ...prev, approvalBaseUrl: e.target.value }))
                }
                placeholder="https://your-ngrok-url"
                className="w-full rounded-lg bg-bg-tertiary border border-border-primary px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-primary/50"
              />
              <p className="text-[11px] text-text-tertiary">
                Optional. If set, approval links use this base instead of localhost.
              </p>
            </div>
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                Communication skill
              </p>
              <Select
                value={execPerms.defaultCommSkillId || ''}
                onChange={(val) =>
                  setExecPerms((prev) => ({ ...prev, defaultCommSkillId: val || undefined }))
                }
                options={[
                  { value: '', label: 'None' },
                  ...commSkills.map((skill) => ({
                    value: skill.id,
                    label: skill.name,
                  })),
                ]}
                className="w-full"
              />
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <Button
              variant="primary"
              size="sm"
              onClick={async () => {
                await gatewayFetch('/api/skills/permissions', {
                  method: 'PUT',
                  body: JSON.stringify({
                    install: installPerm,
                    defaultChannel: execPerms.defaultChannel,
                    defaultUser: execPerms.defaultUser,
                  }),
                });
                await gatewayFetch('/api/execution/permissions', {
                  method: 'PUT',
                  body: JSON.stringify(execPerms),
                });
              }}
            >
              Save Settings
            </Button>
          </div>
        </Card>
      </div>

      <div className="flex-1 overflow-auto px-8 py-4 space-y-4">
        {/* Grant form */}
        {showGrant && (
          <Card className="animate-slide-up">
            <h3 className="text-sm font-semibold text-text-primary mb-4">Grant New Permission</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] text-text-muted mb-1.5 font-medium uppercase tracking-wider">
                  Path
                </label>
                <input
                  type="text"
                  value={grantPath}
                  onChange={(e) => setGrantPath(e.target.value)}
                  placeholder="/path/to/folder"
                  className="w-full rounded-lg bg-bg-tertiary border border-border-primary px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-primary/50 transition-colors"
                />
              </div>
              <div>
                <label className="block text-[11px] text-text-muted mb-1.5 font-medium uppercase tracking-wider">
                  Mode
                </label>
                <Select
                  value={grantMode}
                  onChange={(val) => setGrantMode(val)}
                  options={[
                    { value: 'read_only', label: 'Read Only' },
                    { value: 'full_access', label: 'Full Access' },
                    { value: 'just_in_time', label: 'Just-in-Time' },
                  ]}
                  className="w-full"
                />
              </div>
              <div>
                <label className="block text-[11px] text-text-muted mb-1.5 font-medium uppercase tracking-wider">
                  Duration (mins)
                </label>
                <input
                  type="number"
                  value={grantDuration}
                  onChange={(e) => setGrantDuration(e.target.value)}
                  placeholder="Permanent"
                  className="w-full rounded-lg bg-bg-tertiary border border-border-primary px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-primary/50 transition-colors"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <Button variant="primary" size="sm" onClick={handleGrant}>
                Grant
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setShowGrant(false)}>
                Cancel
              </Button>
            </div>
          </Card>
        )}

        {/* Permissions list */}
        {permissions.length === 0 ? (
          <EmptyState
            icon={Shield}
            title="Default permissions active"
            description="Agent can only access the workspace directory."
          />
        ) : (
          <div className="space-y-2">
            {permissions.map((perm, i) => (
              <Card key={i} hover>
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-bg-tertiary">
                      {perm.mode === 'full_access' ? (
                        <Unlock className="h-4 w-4 text-success" />
                      ) : (
                        <Lock className="h-4 w-4 text-text-tertiary" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-text-primary font-mono">
                          {perm.path}
                        </span>
                        <Badge variant={MODE_VARIANTS[perm.mode] || 'default'}>
                          {MODE_LABELS[perm.mode] || perm.mode}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-[11px] text-text-muted">
                        <span>
                          Granted {formatDistanceToNow(perm.grantedAt, { addSuffix: true })}
                        </span>
                        {perm.expiresAt && (
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {formatDistanceToNow(perm.expiresAt, { addSuffix: true })}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <Button variant="danger" size="sm" onClick={() => handleRevoke(perm.path)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
