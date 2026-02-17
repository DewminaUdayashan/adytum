'use client';

import { useState, useEffect } from 'react';
import { gatewayFetch, api } from '@/lib/api';
import { Card, Badge, Button, Spinner } from '@/components/ui';
import { User, Skull, Clock, Cpu, Plus, Trash2 } from 'lucide-react';
import type { HierarchyNodeData } from './agent-hierarchy-canvas';

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}h ${mm}m`;
}

function formatTimestamp(ts: number): string {
  return new Date(ts * 1000).toLocaleString();
}

interface ModelEntry {
  id: string;
  name?: string;
  provider?: string;
  model?: string;
}

interface AgentDetailPanelProps {
  agent: HierarchyNodeData;
  onClose: () => void;
  onDeath: (id: string) => void;
  onViewLogs: (id: string) => void;
  onUpdate: () => void;
}

interface AgentLogEntry {
  id: string;
  type: string;
  content: string;
  timestamp: number;
}

export function AgentDetailPanel({ agent, onClose, onDeath, onViewLogs, onUpdate }: AgentDetailPanelProps) {
  const [name, setName] = useState(agent.name);
  const [savingName, setSavingName] = useState(false);
  const [availableModels, setAvailableModels] = useState<ModelEntry[]>([]);
  const [modelIds, setModelIds] = useState<string[]>(agent.modelIds ?? []);
  const [savingModels, setSavingModels] = useState(false);
  const [addModelId, setAddModelId] = useState('');
  const [logs, setLogs] = useState<AgentLogEntry[]>([]);
  const [logsOpen, setLogsOpen] = useState(true); // Default open for console feel

  const maxModels = agent.tier === 3 ? 3 : 5;
  const isAlpha = agent.tier === 1;

  // Tier mapping
  const tierLabel = 
    agent.tier === 1 ? 'Alpha (Architect)' :
    agent.tier === 2 ? 'Manager' :
    'Operative';
  
  const roleLabel = agent.tier === 1 ? 'Brain/Architect' : ((agent as any).role || (agent.tier === 2 ? 'Coordinator' : 'Worker'));

  useEffect(() => {
    if (!logsOpen) return;
    gatewayFetch<{ entries: AgentLogEntry[] }>(`/api/agents/${agent.id}/logs`)
      .then((r) => setLogs(r.entries ?? []))
      .catch(() => setLogs([]));
      
    // Poll logs every 2s for "realtime" feel
    const interval = setInterval(() => {
        gatewayFetch<{ entries: AgentLogEntry[] }>(`/api/agents/${agent.id}/logs`)
        .then((r) => setLogs(r.entries ?? []))
        .catch(() => {}); // silent fail
    }, 2000);
    return () => clearInterval(interval);
  }, [agent.id, logsOpen]);
  
  const uptime = agent.endedAt == null && agent.uptimeSeconds != null ? agent.uptimeSeconds : 0;

  useEffect(() => {
    setName(agent.name);
    setModelIds(agent.modelIds ?? []);
  }, [agent.id, agent.name, agent.modelIds]);

  useEffect(() => {
    gatewayFetch<{ models: ModelEntry[] }>('/api/models')
      .then((r) => setAvailableModels(r.models ?? []))
      .catch(() => setAvailableModels([]));
  }, []);

  const saveName = async () => {
    if (name.trim() === agent.name || isAlpha) return;
    setSavingName(true);
    try {
      await api.patch(`/api/agents/${agent.id}`, { name: name.trim() });
      onUpdate();
    } catch {
      // keep local state
    } finally {
      setSavingName(false);
    }
  };

  const saveModelIds = async (next: string[]) => {
    if (isAlpha) return;
    setSavingModels(true);
    try {
      await api.patch(`/api/agents/${agent.id}`, { modelIds: next });
      setModelIds(next);
      onUpdate();
    } catch {
      // revert
    } finally {
      setSavingModels(false);
    }
  };

  const addModel = () => {
    if (!addModelId || modelIds.includes(addModelId)) return;
    const next = [...modelIds, addModelId].slice(0, maxModels);
    setAddModelId('');
    void saveModelIds(next);
  };

  const removeModel = (id: string) => {
    void saveModelIds(modelIds.filter((m) => m !== id));
  };

  const displayId = (id: string) => {
    const m = availableModels.find((x) => x.id === id);
    return m?.name || m?.model || id;
  };

  return (
    <Card className="w-[450px] shrink-0 flex flex-col max-h-[90vh] overflow-hidden bg-bg-secondary/95 border-accent-primary/20 shadow-2xl">
      <div className="flex items-center justify-between p-4 border-b border-border-primary/40 bg-bg-tertiary/30">
        <span className="font-bold text-lg text-text-primary tracking-tight">Agent Link</span>
        <button
          type="button"
          onClick={onClose}
          className="text-text-muted hover:text-text-primary text-xl leading-none"
        >
          ×
        </button>
      </div>

      <div className="flex-1 overflow-auto p-5 space-y-6">
        {/* Header Section */}
        <div className="flex items-center gap-4">
          {agent.avatar ? (
            <img src={agent.avatar} alt="" className="h-16 w-16 rounded-full object-cover border-2 border-accent-primary/50 shadow-lg" />
          ) : (
            <div className="h-16 w-16 rounded-full bg-gradient-to-br from-bg-tertiary to-bg-secondary flex items-center justify-center border-2 border-accent-primary/30">
              <User className="h-8 w-8 text-accent-primary" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <input
              type="text"
              value={name}
              disabled={isAlpha}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => void saveName()}
              className="bg-transparent text-xl font-bold text-text-primary w-full focus:outline-none focus:border-b border-accent-primary/50 mb-1"
              placeholder="Codename"
            />
            <div className="flex items-center gap-2 text-xs">
               <Badge variant={agent.tier === 1 ? 'error' : agent.tier === 2 ? 'info' : 'default'} size="sm">
                  {tierLabel}
               </Badge>
               <span className="px-2 py-0.5 rounded-full bg-bg-tertiary border border-border-primary text-text-secondary">
                  {roleLabel}
               </span>
            </div>
            {agent.endedAt == null && <div className="text-[10px] text-accent-primary mt-1 font-mono">ACTIVE - Uptime: {formatUptime(uptime)}</div>}
          </div>
        </div>

        {/* Info Grid */}
        <div className="grid grid-cols-2 gap-4 text-xs">
             <div className="p-2 rounded bg-bg-tertiary/30 border border-border-primary/30">
                <span className="text-text-muted block mb-0.5 uppercase tracking-wider text-[10px]">Born</span>
                <span className="font-mono text-text-secondary">{formatTimestamp(agent.birthTime)}</span>
             </div>
             {agent.endedAt && (
                 <div className="p-2 rounded bg-error/10 border border-error/20">
                    <span className="text-error/70 block mb-0.5 uppercase tracking-wider text-[10px]">Stop Heartbeat</span>
                    <span className="font-mono text-error">{formatTimestamp(agent.endedAt)}</span>
                 </div>
             )}
        </div>

        {/* Models Section */}
        <div>
             <ul className="flex flex-wrap gap-2">
               {modelIds.map((id) => (
                 <li key={id} className="flex items-center gap-1.5 text-[10px] py-1 px-2 rounded-full bg-accent-primary/10 border border-accent-primary/20 text-accent-primary font-mono shadow-sm">
                   <Cpu className="h-3 w-3" />
                   <span>{displayId(id)}</span>
                 </li>
               ))}
               {modelIds.length === 0 && <li className="text-text-muted text-[10px] italic py-1">No specific models assigned. using system defaults.</li>}
             </ul>
             <p className="text-[10px] text-text-muted/50 mt-2 italic">
                Models are assigned by the Architect at birth. 
             </p>
        </div>

        {/* Console View */}
        <div className="flex flex-col h-64 border border-border-primary/50 rounded-lg overflow-hidden bg-[#0d1117] shadow-inner">
           <div className="flex items-center justify-between px-3 py-1 bg-[#161b22] border-b border-border-primary/20">
              <span className="text-[10px] font-mono text-text-muted uppercase">Terminal Output</span>
              <div className="flex gap-1">
                 <div className="w-2 h-2 rounded-full bg-red-500/20"></div>
                 <div className="w-2 h-2 rounded-full bg-yellow-500/20"></div>
                 <div className="w-2 h-2 rounded-full bg-green-500/20"></div>
              </div>
           </div>
           <div className="flex-1 overflow-y-auto p-3 font-mono text-[10px] space-y-1">
              {logs.length === 0 ? (
                 <span className="text-text-muted/50 animate-pulse">_ waiting for signal...</span>
              ) : (
                 logs.slice(-50).map((entry) => (
                    <div key={entry.id} className="break-words">
                       <span className="text-text-muted opacity-50">[{new Date(entry.timestamp * 1000).toLocaleTimeString([], {hour12: false})}]</span>{' '}
                       <span className={
                           entry.type === 'thought' ? 'text-yellow-400' :
                           entry.type === 'action' ? 'text-blue-400' :
                           entry.type === 'error' ? 'text-red-400' :
                           'text-green-400'
                       }>{entry.type.toUpperCase()}</span>{': '}
                       <span className="text-gray-300">{entry.content}</span>
                       {(entry as any).model && <span className="text-xs text-purple-400/70 ml-2">[{ (entry as any).model }]</span>}
                    </div>
                 ))
              )}
              {/* Auto-scroll anchor would go here */}
           </div>
        </div>

        {/* Footer Actions */}
        <div className="pt-2 flex justify-end">
          {agent.endedAt == null && !isAlpha && (
            <Button
              variant="ghost"
              size="sm"
              className="text-error hover:bg-error/10"
              onClick={() => confirm('WARNING: Terminating agent process. This cannot be undone. \n\nProceed with Stop Heartbeat?') && onDeath(agent.id)}
            >
              <Skull className="h-4 w-4 mr-2" />
              Stop Heartbeat
            </Button>
          )}
          {isAlpha && (
              <span className="text-[10px] text-text-muted italic flex items-center">
                 <div className="w-1.5 h-1.5 bg-green-500 rounded-full mr-1 animate-pulse"></div>
                 Alpha System Protected
              </span>
          )}
        </div>
      </div>
    </Card>
  );
}
