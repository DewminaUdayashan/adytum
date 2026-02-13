'use client';

import { useState, useEffect } from 'react';
import { clsx } from 'clsx';
import { ChevronDown, Brain, Zap, Cpu } from 'lucide-react';
import { Select } from '@/components/ui/select';
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
  defaultRole: string;
}

const ROLE_ICONS: Record<string, any> = {
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

  useEffect(() => {
    gatewayFetch<{ roles: string[]; chains: Record<string, string[]>; defaultRole: string }>('/api/config/roles')
      .then((data) => {
        setConfig(data);
        // Set initial model if needed
        if (!selectedModelId && data.chains[selectedRole]?.[0]) {
           onModelChange(data.chains[selectedRole][0]);
        }
      })
      .catch((err) => console.error('Failed to load roles config', err));
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

  const currentChain = config.chains[selectedRole] || [];
  
  // Format model ID for display (provider/model -> model)
  const formatModelName = (id: string) => {
    const parts = id.split('/');
    return parts.length > 1 ? parts.slice(1).join('/') : id;
  };

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
                  : 'text-text-tertiary hover:text-text-secondary hover:bg-bg-tertiary/50'
              )}
            >
              <Icon size={12} className={clsx(isActive ? 'text-accent-primary' : 'opacity-70')} />
              <span className="capitalize">{role}</span>
            </button>
          );
        })}
      </div>

      {/* Model Dropdown */}
      <div className="relative">
         <select
            value={selectedModelId}
            onChange={(e) => onModelChange(e.target.value)}
            className="appearance-none bg-transparent text-xs font-medium text-text-secondary hover:text-text-primary py-1 pr-6 cursor-pointer focus:outline-none"
         >
            {currentChain.map((modelId) => (
              <option key={modelId} value={modelId}>
                {formatModelName(modelId)}
              </option>
            ))}
            {currentChain.length === 0 && <option disabled>No models configured</option>}
         </select>
         <ChevronDown size={12} className="absolute right-0 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none" />
      </div>
    </div>
  );
}
