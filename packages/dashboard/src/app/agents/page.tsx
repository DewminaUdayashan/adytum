'use client';

/**
 * @file packages/dashboard/src/app/agents/page.tsx
 * @description Hierarchical Multi-Agent: hierarchy view, graveyard, agent detail, logbook, settings.
 */

import { useState, useEffect, useCallback } from 'react';
import { gatewayFetch, api } from '@/lib/api';
import {
  PageHeader,
  Card,
  Badge,
  Button,
  Spinner,
  EmptyState,
} from '@/components/ui';
import {
  GitBranch,
  Skull,
  BookOpen,
  Settings,
  User,
  Clock,
  Sparkles,
  Save,
  Plus,
  Trash2,
} from 'lucide-react';
import { Select } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { clsx } from 'clsx';
import { AgentHierarchyCanvas, type HierarchyNodeData } from '@/components/agents/agent-hierarchy-canvas';
import { AgentDetailPanel } from '@/components/agents/agent-detail-panel';

// ─── Types ─────────────────────────────────────────────────────

interface AgentMetadata {
  id: string;
  name: string;
  tier: 1 | 2 | 3;
  birthTime: number;
  lastBreath: number | null;
  avatar: string | null;
  parentId: string | null;
}

interface AgentWithUptime extends AgentMetadata {
  uptimeSeconds?: number;
}

interface HierarchyNode extends AgentWithUptime {
  children: HierarchyNode[];
  modelIds?: string[];
}

interface HierarchyResponse {
  hierarchy: HierarchyNode[];
}

interface LogbookResponse {
  content: string;
}

interface AgentLogEntry {
  id: string;
  agentId: string;
  timestamp: number;
  type: 'thought' | 'action' | 'interaction';
  content: string;
  payload?: Record<string, unknown>;
}

interface HierarchySettings {
  avatarGenerationEnabled: boolean;
  maxTier2Agents: number;
  maxTier3Agents: number;
  defaultRetryLimit: number;
  modelPriorityTier1And2: string[];
  modelPriorityTier3: string[];
}

// ─── Helpers ────────────────────────────────────────────────────

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

function findAgentInTree(nodes: HierarchyNode[], id: string): HierarchyNodeData | null {
  for (const node of nodes) {
    if (node.id === id) {
      return {
        id: node.id,
        name: node.name,
        tier: node.tier,
        birthTime: node.birthTime,
        endedAt: node.lastBreath,
        avatar: node.avatar,
        parentId: node.parentId,
        uptimeSeconds: node.uptimeSeconds,
        modelIds: node.modelIds ?? [],
      };
    }
    const inChild = findAgentInTree(node.children ?? [], id);
    if (inChild) return inChild;
  }
  return null;
}

// ─── Component ──────────────────────────────────────────────────

export default function AgentsPage() {
  const [tab, setTab] = useState<'hierarchy' | 'graveyard' | 'logbook' | 'settings'>('hierarchy');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hierarchy, setHierarchy] = useState<HierarchyNode[]>([]);
  const [graveyard, setGraveyard] = useState<AgentWithUptime[]>([]);
  const [logbookContent, setLogbookContent] = useState('');
  const [settings, setSettings] = useState<HierarchySettings | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<HierarchyNodeData | null>(null);
  const [agentLogs, setAgentLogs] = useState<AgentLogEntry[]>([]);
  const [birthForm, setBirthForm] = useState({ name: '', tier: 2 as 1 | 2 | 3, parentId: '' });
  const [savingSettings, setSavingSettings] = useState(false);
  const [canvasRefreshTrigger, setCanvasRefreshTrigger] = useState(0);

  const defaultParentId = hierarchy[0]?.id ?? '';

  const loadHierarchy = useCallback(async (): Promise<HierarchyNode[]> => {
    const res = await gatewayFetch<HierarchyResponse>('/api/agents/hierarchy');
    const list = res.hierarchy ?? [];
    setHierarchy(list);
    return list;
  }, []);

  const loadGraveyard = useCallback(async () => {
    const res = await gatewayFetch<{ agents: AgentWithUptime[] }>('/api/agents/graveyard');
    setGraveyard(res.agents ?? []);
  }, []);

  const loadLogbook = useCallback(async () => {
    const res = await gatewayFetch<LogbookResponse>('/api/agents/logbook');
    setLogbookContent(res.content ?? '');
  }, []);

  const loadSettings = useCallback(async () => {
    const res = await gatewayFetch<HierarchySettings>('/api/agents/settings');
    setSettings(res);
  }, []);

  const loadAgentLogs = useCallback(async (agentId: string) => {
    const res = await gatewayFetch<{ entries: AgentLogEntry[] }>(`/api/agents/${agentId}/logs`);
    setAgentLogs(res.entries ?? []);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setLoading(true);
    (async () => {
      try {
        await Promise.all([loadHierarchy(), loadGraveyard(), loadLogbook(), loadSettings()]);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadHierarchy, loadGraveyard, loadLogbook, loadSettings]);

  useEffect(() => {
    if (!selectedAgentId) {
      setAgentLogs([]);
      return;
    }
    loadAgentLogs(selectedAgentId);
  }, [selectedAgentId, loadAgentLogs]);

  const handleBirth = async () => {
    if (!birthForm.name.trim()) {
      setError('Agent name is required');
      return;
    }
    setError(null);
    try {
      await api.post('/api/agents/birth', {
        name: birthForm.name.trim(),
        tier: birthForm.tier,
        parentId: birthForm.parentId?.trim() || (birthForm.tier !== 1 ? defaultParentId || null : null) || null,
      });
      setBirthForm((f) => ({ ...f, name: '', parentId: defaultParentId }));
      await loadHierarchy();
      await loadGraveyard();
      setCanvasRefreshTrigger((t) => t + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleDeath = async (id: string) => {
    try {
      await api.post(`/api/agents/${id}/death`);
      setSelectedAgentId(null);
      await loadHierarchy();
      await loadGraveyard();
      setCanvasRefreshTrigger((t) => t + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleDeactivateAllSubagents = async () => {
    if (!confirm('Deactivate all Tier 2 and Tier 3 agents (Last Breath)? Prometheus (Tier 1) will remain active.')) return;
    try {
      const res = await api.post<{ deactivated: number; ids: string[] }>('/api/agents/deactivate-all-subagents');
      const n = res?.deactivated ?? 0;
      if (n > 0) {
        setSelectedAgent(null);
        setSelectedAgentId(null);
        await Promise.all([loadHierarchy(), loadGraveyard()]);
        setCanvasRefreshTrigger((t) => t + 1);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const saveSettings = async () => {
    if (!settings) return;
    setSavingSettings(true);
    try {
      await api.put('/api/agents/settings', settings);
      await loadSettings();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingSettings(false);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader
        title="Agent Management"
        subtitle="Hierarchical multi-agent system: Prometheus (Tier 1), senior agents (Tier 2), and sub-agents (Tier 3). Birth Protocol and Graveyard."
      >
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              loadHierarchy();
              loadGraveyard();
              loadLogbook();
            }}
          >
            Refresh
          </Button>
        </div>
      </PageHeader>

      {error && (
        <div className="mx-8 mt-4 px-4 py-2 rounded-lg bg-error/10 text-error text-sm">{error}</div>
      )}

      {/* Tabs */}
      <div className="px-8 pt-4 flex gap-2 border-b border-border-primary/20">
        {(
          [
            { id: 'hierarchy', label: 'Hierarchy', icon: GitBranch },
            { id: 'graveyard', label: 'Graveyard', icon: Skull },
            { id: 'logbook', label: 'LOGBOOK', icon: BookOpen },
            { id: 'settings', label: 'Global Settings', icon: Settings },
          ] as const
        ).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={clsx(
              'flex items-center gap-2 px-4 py-2.5 rounded-t-lg text-sm font-medium transition-colors',
              tab === id
                ? 'bg-bg-secondary text-accent-primary border border-border-primary border-b-0 -mb-px'
                : 'text-text-muted hover:text-text-primary',
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto p-8">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Spinner size="lg" />
          </div>
        ) : (
          <>
            {tab === 'hierarchy' && (
                <div className="flex flex-col h-[calc(100vh-12rem)] min-h-0">
                <div className="flex flex-1 min-h-0 gap-4">
                  <div className="flex flex-col flex-1 min-w-0 rounded-xl border border-border-primary/40 overflow-hidden bg-bg-secondary/30">
                    <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider px-4 py-2 border-b border-border-primary/40 shrink-0">
                      Organizational chart — pan, zoom, click node for details
                    </h3>
                    <div className="flex-1 min-h-[560px] w-full">
                      <AgentHierarchyCanvas
                        selectedAgentId={selectedAgent?.id ?? null}
                        onSelectAgent={setSelectedAgent}
                        refreshTrigger={canvasRefreshTrigger}
                      />
                    </div>
                  </div>
                  {selectedAgent && (
                    <AgentDetailPanel
                      agent={selectedAgent}
                      onClose={() => setSelectedAgent(null)}
                      onDeath={async () => {
                        if (confirm('Deactivate this agent (Last Breath)?')) {
                          await handleDeath(selectedAgent.id);
                          setSelectedAgent(null);
                        }
                      }}
                      onViewLogs={() => setSelectedAgentId(selectedAgent.id)}
                      onUpdate={() => {
                        loadHierarchy().then((list) => {
                          const updated = findAgentInTree(list, selectedAgent.id);
                          if (updated) setSelectedAgent(updated);
                          setCanvasRefreshTrigger((t) => t + 1);
                        });
                      }}
                    />
                  )}
                </div>
              </div>
            )}

            {tab === 'graveyard' && (
               <div className="space-y-4 p-4">
                 <div className="flex items-center justify-between mb-2">
                   <h2 className="text-sm font-semibold text-text-muted uppercase tracking-wider flex items-center gap-2">
                     <Skull className="h-4 w-4" />
                     Graveyard (Deactivated / Last Breath)
                   </h2>
                 </div>
                 
                 {graveyard.length === 0 ? (
                     <div className="p-12 text-center border-2 border-dashed border-border-primary/30 rounded-xl bg-bg-tertiary/20">
                         <Skull className="h-8 w-8 text-text-muted/20 mx-auto mb-2" />
                         <p className="text-text-muted italic">No agents have perished yet.</p>
                     </div>
                 ) : (
                     <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                         {graveyard.map((agent) => (
                             <Card 
                                 key={agent.id} 
                                 className="aspect-[3/4] relative overflow-hidden group hover:border-accent-primary/50 transition-all cursor-pointer bg-bg-secondary/40 hover:bg-bg-tertiary/60"
                                 onClick={() => setSelectedAgentId(agent.id)}
                             >
                                 <div className="absolute inset-0 bg-gradient-to-t from-bg-primary via-transparent to-transparent opacity-90" />
                                 <div className="absolute inset-0 p-3 flex flex-col items-center justify-between text-center z-10">
                                     <div className="mt-2 relative grayscale contrast-125 group-hover:grayscale-0 transition-all duration-500">
                                         {agent.avatar ? (
                                             <img src={agent.avatar} alt="" className="h-16 w-16 rounded-full object-cover shadow-lg border-2 border-border-primary/50" />
                                         ) : (
                                             <div className="h-16 w-16 rounded-full bg-bg-primary/80 flex items-center justify-center border-2 border-border-primary/50 shadow-inner">
                                                 <User className="h-8 w-8 text-text-muted" />
                                             </div>
                                         )}
                                          {/* RIP Badge */}
                                         <div className="absolute -bottom-1 -right-1 bg-bg-primary text-[7px] border border-border-primary px-1 rounded font-mono text-text-muted">RIP</div>
                                     </div>
                                     
                                     <div className="w-full">
                                        <h3 className="font-serif font-bold text-xs text-text-secondary truncate w-full group-hover:text-text-primary transition-colors">
                                            {agent.name}
                                        </h3>
                                        <div className="text-[8px] uppercase tracking-wider text-text-muted mt-0.5 font-mono truncate">
                                             {agent.tier === 1 ? "Brain/Architect" : ((agent as any).role || `Tier ${agent.tier}`)}
                                        </div>
                                     </div>
                                     
                                      <div className="w-full flex flex-col gap-0.5 mt-1 border-t border-border-primary/20 pt-1">
                                          <div className="flex justify-between items-center text-[7px] text-text-muted/60 font-mono">
                                              <span>BORN</span>
                                              <span>{new Date(agent.birthTime * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                                          </div>
                                          <div className="flex justify-between items-center text-[7px] text-error/60 font-mono">
                                              <span>ENDED</span>
                                              <span>{new Date((agent.lastBreath || 0) * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                                          </div>
                                      </div>
                                 </div>
                             </Card>
                         ))}
                     </div>
                 )}
               </div>
            )}

            {tab === 'logbook' && (
              <Card className="p-5">
                <pre className="text-sm text-text-secondary whitespace-pre-wrap font-mono overflow-x-auto">
                  {logbookContent || 'No entries yet.'}
                </pre>
              </Card>
            )}

            {tab === 'settings' && settings && (
              <Card className="max-w-xl space-y-8 p-6">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-lg">Hierarchy settings</h3>
                  <Button size="sm" onClick={saveSettings} disabled={savingSettings}>
                    {savingSettings ? <Spinner size="sm" /> : <Save className="h-4 w-4 mr-1" />}
                    Save Settings
                  </Button>
                </div>
                <div className="pt-2 border-t border-border-primary/40">
                  <Checkbox
                    checked={settings.avatarGenerationEnabled}
                    onChange={(e) =>
                      setSettings((s) => ({ ...s!, avatarGenerationEnabled: e.target.checked }))
                    }
                    label="Avatar generation (DiceBear)"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-text-muted block mb-1">Max Tier 2 agents</label>
                    <input
                      type="number"
                      min={0}
                      max={50}
                      value={settings.maxTier2Agents}
                      onChange={(e) =>
                        setSettings((s) => ({ ...s!, maxTier2Agents: Number(e.target.value) || 0 }))
                      }
                      className="w-full rounded-lg border border-border-primary bg-bg-primary px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-text-muted block mb-1">Max Tier 3 agents</label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={settings.maxTier3Agents}
                      onChange={(e) =>
                        setSettings((s) => ({ ...s!, maxTier3Agents: Number(e.target.value) || 0 }))
                      }
                      className="w-full rounded-lg border border-border-primary bg-bg-primary px-3 py-2 text-sm"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-text-muted block mb-1">Default retry limit per task</label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={settings.defaultRetryLimit}
                    onChange={(e) =>
                      setSettings((s) => ({ ...s!, defaultRetryLimit: Number(e.target.value) || 3 }))
                    }
                    className="w-24 rounded-lg border border-border-primary bg-bg-primary px-3 py-2 text-sm"
                  />
                </div>
                <p className="text-xs text-text-muted">
                  Model priority lists (Tier 1/2: up to 5 models, Tier 3: up to 3) are configured in
                  Model Settings. Critical task failure after max retries triggers emergency stop.
                </p>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}
