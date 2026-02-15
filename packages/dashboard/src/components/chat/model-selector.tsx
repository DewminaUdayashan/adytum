'use client';

/**
 * @file packages/dashboard/src/components/chat/model-selector.tsx
 * @description Defines reusable UI components for the dashboard.
 */

import { useState, useEffect } from 'react';
import { clsx } from 'clsx';
import { Brain, Zap, Cpu, AlertTriangle, Clock3, type LucideIcon } from 'lucide-react';
import { Select } from '@/components/ui';
import { gatewayFetch } from '@/lib/api';

interface ChatModelSelectorProps {
  selectedRole: string;
  selectedModelId: string;
  onRoleChange: (role: string) => void;
  onModelChange: (modelId: string) => void;
}

interface RolesConfig {
  roles: string[];
  chains: Record<string, string[]>;
}

interface ModelRuntimeStatus {
  state: 'rate_limited' | 'quota_exceeded';
  cooldownUntil: number;
  resetAt?: number;
  message?: string;
  updatedAt: number;
}

const ROLE_ICONS: Record<string, LucideIcon> = {
  thinking: Brain,
  fast: Zap,
  local: Cpu,
};

export function ChatModelSelector({
  selectedRole,
  selectedModelId,
  onRoleChange,
  onModelChange,
}: ChatModelSelectorProps) {
  const [config, setConfig] = useState<RolesConfig | null>(null);
  const [runtimeStatuses, setRuntimeStatuses] = useState<Record<string, ModelRuntimeStatus>>({});
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    gatewayFetch<RolesConfig>('/api/config/roles')
      .then((data) => {
        setConfig(data);
        // Set initial model if needed
        if (!selectedModelId && data.chains[selectedRole]?.[0]) {
          onModelChange(data.chains[selectedRole][0]);
        }
      })
      .catch((err) => console.error('Failed to load roles config', err));
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadStatuses = () => {
      gatewayFetch<{ statuses: Record<string, ModelRuntimeStatus> }>('/api/models/runtime-status')
        .then((data) => {
          if (!cancelled) {
            setRuntimeStatuses(data.statuses || {});
          }
        })
        .catch(() => {
          if (!cancelled) {
            setRuntimeStatuses({});
          }
        });
    };

    loadStatuses();
    const interval = window.setInterval(loadStatuses, 15_000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  // When role changes, auto-select first model in chain if current model invalid for new role
  useEffect(() => {
    if (!config) return;
    const chain = config.chains[selectedRole] || [];
    if (!chain.includes(selectedModelId) && chain.length > 0) {
      onModelChange(chain[0]);
    }
  }, [selectedRole, config]);

  if (!config) return null;

  const formatDuration = (ms: number): string => {
    const seconds = Math.max(1, Math.floor(ms / 1000));
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      const remMin = minutes % 60;
      return remMin > 0 ? `${hours}h ${remMin}m` : `${hours}h`;
    }
    if (minutes > 0) return `${minutes}m`;
    return `${seconds}s`;
  };

  const getStatusText = (status: ModelRuntimeStatus): string => {
    const target = status.resetAt || status.cooldownUntil;
    const remaining = target - nowMs;
    const stateText = status.state === 'quota_exceeded' ? 'Quota exceeded' : 'Rate limited';
    if (remaining <= 0) return `${stateText} - retrying soon`;
    return `${stateText} - resets in ${formatDuration(remaining)}`;
  };

  const currentChain = config.chains[selectedRole] || [];
  const modelOptions = currentChain.map((modelId) => {
    const [provider, ...rest] = modelId.split('/');
    const status = runtimeStatuses[modelId];
    const statusText = status ? getStatusText(status) : null;
    return {
      value: modelId,
      label: rest.length ? rest.join('/') : modelId,
      description: statusText ? `${provider} • ${statusText}` : provider || undefined,
      icon: status ? (
        status.state === 'quota_exceeded' ? (
          <AlertTriangle size={12} className="text-error" />
        ) : (
          <Clock3 size={12} className="text-warning" />
        )
      ) : undefined,
    };
  });

  return (
    <div className="flex items-center gap-3 py-1.5 px-1 animate-fade-in">
      {/* Role Pills */}
      <div className="flex bg-bg-secondary p-1 rounded-lg border border-border-primary">
        {config.roles.map((role) => {
          const Icon = ROLE_ICONS[role] || Brain;
          const isActive = selectedRole === role;

          return (
            <button
              key={role}
              onClick={() => onRoleChange(role)}
              className={clsx(
                'flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-all',
                isActive
                  ? 'bg-bg-primary text-text-primary shadow-sm ring-1 ring-border-primary'
                  : 'text-text-tertiary hover:text-text-secondary hover:bg-bg-tertiary/50',
              )}
            >
              <Icon size={12} className={clsx(isActive ? 'text-accent-primary' : 'opacity-70')} />
              <span className="capitalize">{role}</span>
            </button>
          );
        })}
      </div>

      {/* Model Dropdown */}
      <Select
        value={selectedModelId}
        onChange={(val) => onModelChange(val)}
        options={modelOptions}
        placeholder="No models configured"
        disabled={currentChain.length === 0}
        className="min-w-[190px] text-xs"
        placement="up"
      />
    </div>
  );
}
