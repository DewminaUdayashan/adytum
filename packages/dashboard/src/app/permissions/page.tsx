'use client';

import { useState } from 'react';
import { usePolling } from '@/hooks/use-polling';
import { gatewayFetch } from '@/lib/api';
import { PageHeader, Card, Badge, Spinner, EmptyState, Button } from '@/components/ui';
import { Shield, FolderOpen, Plus, Trash2, Clock, Lock, Unlock } from 'lucide-react';
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

export default function PermissionsPage() {
  const { data, loading, refresh } = usePolling<PermissionsResponse>('/api/permissions', 5000);
  const [showGrant, setShowGrant] = useState(false);
  const [grantPath, setGrantPath] = useState('');
  const [grantMode, setGrantMode] = useState('read_only');
  const [grantDuration, setGrantDuration] = useState('');

  const permissions = data?.permissions || [];

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
    <div className="flex flex-col h-full">
      <PageHeader title="Permissions" subtitle="File and folder access control for the agent">
        <Button variant="primary" size="sm" onClick={() => setShowGrant(!showGrant)}>
          <Plus className="h-3 w-3" />
          Grant Access
        </Button>
      </PageHeader>

      <div className="flex-1 overflow-auto p-6 space-y-4">
        {/* Grant form */}
        {showGrant && (
          <Card className="animate-slide-up">
            <h3 className="text-sm font-semibold text-adytum-text mb-3">Grant New Permission</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-adytum-text-muted mb-1">Path</label>
                <input
                  type="text"
                  value={grantPath}
                  onChange={(e) => setGrantPath(e.target.value)}
                  placeholder="/path/to/folder"
                  className="w-full rounded-lg bg-adytum-bg border border-adytum-border px-3 py-2 text-sm text-adytum-text focus:outline-none focus:border-adytum-accent"
                />
              </div>
              <div>
                <label className="block text-xs text-adytum-text-muted mb-1">Mode</label>
                <select
                  value={grantMode}
                  onChange={(e) => setGrantMode(e.target.value)}
                  className="w-full rounded-lg bg-adytum-bg border border-adytum-border px-3 py-2 text-sm text-adytum-text focus:outline-none focus:border-adytum-accent"
                >
                  <option value="read_only">Read Only</option>
                  <option value="full_access">Full Access</option>
                  <option value="just_in_time">Just-in-Time</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-adytum-text-muted mb-1">Duration (minutes, optional)</label>
                <input
                  type="number"
                  value={grantDuration}
                  onChange={(e) => setGrantDuration(e.target.value)}
                  placeholder="Permanent if empty"
                  className="w-full rounded-lg bg-adytum-bg border border-adytum-border px-3 py-2 text-sm text-adytum-text focus:outline-none focus:border-adytum-accent"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-3">
              <Button variant="primary" size="sm" onClick={handleGrant}>Grant</Button>
              <Button variant="ghost" size="sm" onClick={() => setShowGrant(false)}>Cancel</Button>
            </div>
          </Card>
        )}

        {/* Permissions list */}
        {permissions.length === 0 ? (
          <EmptyState
            icon={Shield}
            title="Default permissions active"
            description="The agent can only access the workspace directory. Grant additional permissions above."
          />
        ) : (
          <div className="space-y-2">
            {permissions.map((perm, i) => (
              <Card key={i} hover>
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-adytum-surface-2">
                    {perm.mode === 'full_access' ? (
                      <Unlock className="h-4 w-4 text-adytum-success" />
                    ) : (
                      <Lock className="h-4 w-4 text-adytum-warning" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <FolderOpen className="h-3.5 w-3.5 text-adytum-text-muted" />
                      <span className="text-sm font-medium text-adytum-text font-mono truncate">
                        {perm.path}
                      </span>
                      <Badge variant={MODE_VARIANTS[perm.mode] || 'default'}>
                        {MODE_LABELS[perm.mode] || perm.mode}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-adytum-text-muted">
                      <span>
                        Granted {formatDistanceToNow(perm.grantedAt, { addSuffix: true })}
                      </span>
                      {perm.expiresAt && (
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          Expires {formatDistanceToNow(perm.expiresAt, { addSuffix: true })}
                        </span>
                      )}
                    </div>
                  </div>
                  <Button variant="danger" size="sm" onClick={() => handleRevoke(perm.path)}>
                    <Trash2 className="h-3 w-3" />
                    Revoke
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
