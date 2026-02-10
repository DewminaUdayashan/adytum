'use client';

import { useState } from 'react';
import { usePolling } from '@/hooks/use-polling';
import { gatewayFetch } from '@/lib/api';
import { Card, Badge, Spinner, EmptyState, Button } from '@/components/ui';
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
    <div className="flex flex-col h-full animate-fade-in">
      {/* Header */}
      <div className="px-8 pt-8 pb-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-[0.2em] text-text-muted font-medium">Security</p>
            <h1 className="text-2xl font-semibold text-text-primary tracking-tight mt-1">Permissions</h1>
          </div>
          <Button variant="primary" size="sm" onClick={() => setShowGrant(!showGrant)}>
            <Plus className="h-3.5 w-3.5" />
            Grant Access
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-8 py-4 space-y-4">
        {/* Grant form */}
        {showGrant && (
          <Card className="animate-slide-up">
            <h3 className="text-sm font-semibold text-text-primary mb-4">Grant New Permission</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] text-text-muted mb-1.5 font-medium uppercase tracking-wider">Path</label>
                <input
                  type="text"
                  value={grantPath}
                  onChange={(e) => setGrantPath(e.target.value)}
                  placeholder="/path/to/folder"
                  className="w-full rounded-lg bg-bg-tertiary border border-border-primary px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-primary/50 transition-colors"
                />
              </div>
              <div>
                <label className="block text-[11px] text-text-muted mb-1.5 font-medium uppercase tracking-wider">Mode</label>
                <select
                  value={grantMode}
                  onChange={(e) => setGrantMode(e.target.value)}
                  className="w-full rounded-lg bg-bg-tertiary border border-border-primary px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-primary/50 transition-colors"
                >
                  <option value="read_only">Read Only</option>
                  <option value="full_access">Full Access</option>
                  <option value="just_in_time">Just-in-Time</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-text-muted mb-1.5 font-medium uppercase tracking-wider">Duration (mins)</label>
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
                        <span className="text-sm font-medium text-text-primary font-mono">{perm.path}</span>
                        <Badge variant={MODE_VARIANTS[perm.mode] || 'default'}>
                          {MODE_LABELS[perm.mode] || perm.mode}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-[11px] text-text-muted">
                        <span>Granted {formatDistanceToNow(perm.grantedAt, { addSuffix: true })}</span>
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
