'use client';

import { useState, useEffect } from 'react';
import { usePolling } from '@/hooks/use-polling';
import { gatewayFetch } from '@/lib/api';
import { PageHeader, Card, Badge, Button, Spinner, Select, EmptyState } from '@/components/ui';
import { 
  Heart, 
  Moon, 
  MessageSquare, 
  Sparkles, 
  Save, 
  RotateCcw,
  Activity,
  Zap,
  Brain,
  Cpu,
  Target,
  Calendar,
  Plus,
  Trash2,
  FileText
} from 'lucide-react';
import { clsx } from 'clsx';

// --- Interfaces ---

interface SoulConfig {
  autoUpdate: boolean;
}

interface ScheduleConfig {
  monitor: { interval: number; enabled: boolean };
  dreamer: { interval: number; enabled: boolean };
  monologue: { interval: number; enabled: boolean };
}

interface TaskOverrides {
  [key: string]: string; // taskName -> modelId or role
}

interface Goal {
  id: string;
  title: string;
  description: string;
  status: 'active' | 'completed' | 'paused';
  priority: 'high' | 'medium' | 'low';
}

const MODEL_ROLES = [
    { value: 'thinking', label: 'Thinking', icon: <Brain size={14} />, description: 'Complex reasoning' },
    { value: 'fast', label: 'Fast', icon: <Zap size={14} />, description: 'Quick responses' },
    { value: 'local', label: 'Local', icon: <Cpu size={14} />, description: 'Private & offline' },
];

export default function AgentSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modified, setModified] = useState(false);
  const [activeTab, setActiveTab] = useState<'lifecycles' | 'soul' | 'heartbeat'>('lifecycles');

  // Config State
  const [soulConfig, setSoulConfig] = useState<SoulConfig>({ autoUpdate: true });
  const [schedules, setSchedules] = useState<ScheduleConfig>({
    monitor: { interval: 30, enabled: true },
    dreamer: { interval: 30, enabled: true },
    monologue: { interval: 15, enabled: true },
  });
  const [overrides, setOverrides] = useState<TaskOverrides>({});

  // Content State
  const [soulContent, setSoulContent] = useState('');
  const [heartbeatContent, setHeartbeatContent] = useState('');

  // Original State for Reset
  const [originalSoulContent, setOriginalSoulContent] = useState('');
  const [originalHeartbeatContent, setOriginalHeartbeatContent] = useState('');
  
  // Heartbeat View State
  const [heartbeatView, setHeartbeatView] = useState<'editor' | 'goals'>('goals');
  const [goals, setGoals] = useState<Goal[]>([]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [soulRes, schedRes, overrideRes, soulText, mbText] = await Promise.all([
        gatewayFetch<{ soul: SoulConfig }>('/api/config/soul'),
        gatewayFetch<ScheduleConfig>('/api/schedules'),
        gatewayFetch<{ taskOverrides: TaskOverrides }>('/api/config/overrides'),
        gatewayFetch<{ content: string }>('/api/personality'),
        gatewayFetch<{ content: string }>('/api/heartbeat'),
      ]);

      setSoulConfig(soulRes.soul);
      // Transform flat API response { heartbeat, dreamer, monologue } to ScheduleConfig
      const sched = schedRes as any;
      setSchedules({
        monitor: { interval: sched.heartbeat || 30, enabled: true },
        dreamer: { interval: sched.dreamer || 30, enabled: true },
        monologue: { interval: sched.monologue || 15, enabled: true },
      });
      setOverrides(overrideRes.taskOverrides);
      setSoulContent(soulText.content);
      setOriginalSoulContent(soulText.content);
      setHeartbeatContent(mbText.content);
      setOriginalHeartbeatContent(mbText.content);
      setGoals(parseGoals(mbText.content));
      
      setModified(false);
    } catch (err) {
      console.error('Failed to load agent config', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // --- Helpers for Heartbeat Goals ---
  const parseGoals = (markdown: string): Goal[] => {
    const goals: Goal[] = [];
    const lines = markdown.split('\n');
    let current: Partial<Goal> | null = null;
  
    for (const line of lines) {
      const headerMatch = line.match(/^##\s+(.+)$/);
      if (headerMatch) {
        if (current?.title) goals.push(current as Goal);
        current = {
          id: crypto.randomUUID(),
          title: headerMatch[1],
          description: '',
          status: 'active',
          priority: 'medium',
        };
        continue;
      }
  
      if (current) {
        const statusMatch = line.match(/^-\s+\*\*Status\*\*:\s*(\w+)/i);
        const priorityMatch = line.match(/^-\s+\*\*Priority\*\*:\s*(\w+)/i);
  
        if (statusMatch) {
          current.status = statusMatch[1].toLowerCase() as Goal['status'];
        } else if (priorityMatch) {
          current.priority = priorityMatch[1].toLowerCase() as Goal['priority'];
        } else if (line.trim() && !line.startsWith('#') && !line.startsWith('-')) {
          current.description = ((current.description || '') + '\n' + line).trim();
        }
      }
    }
  
    if (current?.title) goals.push(current as Goal);
    return goals;
  };
  
  const goalsToMarkdown = (goals: Goal[]): string => {
    if (goals.length === 0) return '# Heartbeat\n\nNo goals defined yet.\n';
  
    let md = '# Heartbeat\n\n';
    for (const goal of goals) {
      md += `## ${goal.title}\n\n`;
      if (goal.description) md += `${goal.description}\n\n`;
      md += `- **Status**: ${goal.status}\n`;
      md += `- **Priority**: ${goal.priority}\n\n`;
    }
    return md;
  };

  // --- Handlers ---

  const handleSave = async () => {
    setSaving(true);
    try {
      // Sync goals to content if currently in goals view
      const finalHeartbeatContent = heartbeatView === 'goals' ? goalsToMarkdown(goals) : heartbeatContent;

      await Promise.all([
        gatewayFetch('/api/config/soul', {
            method: 'PUT',
            body: JSON.stringify({ soul: soulConfig })
        }),
        gatewayFetch('/api/config/overrides', {
            method: 'PUT',
            body: JSON.stringify({ taskOverrides: overrides })
        }),
        gatewayFetch('/api/schedules', {
            method: 'PUT',
            body: JSON.stringify({
                heartbeat: schedules.monitor.interval,
                dreamer: schedules.dreamer.interval,
                monologue: schedules.monologue.interval
            })
        }),
        gatewayFetch('/api/personality', {
            method: 'PUT',
            body: JSON.stringify({ content: soulContent })
        }),
        gatewayFetch('/api/heartbeat', {
            method: 'PUT',
            body: JSON.stringify({ content: finalHeartbeatContent })
        })
      ]);
      
      setOriginalSoulContent(soulContent);
      setOriginalHeartbeatContent(finalHeartbeatContent);
      setHeartbeatContent(finalHeartbeatContent);
      setModified(false);
    } catch (err) {
      console.error('Failed to save', err);
      alert('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const toggleSoulAutoUpdate = () => {
    setSoulConfig(prev => ({ ...prev, autoUpdate: !prev.autoUpdate }));
    setModified(true);
  };

  // Check for modifications
  useEffect(() => {
      const isHeartbeatChanged = heartbeatView === 'goals' 
        ? goalsToMarkdown(goals) !== originalHeartbeatContent 
        : heartbeatContent !== originalHeartbeatContent;
      
      const isSoulChanged = soulContent !== originalSoulContent;
      
      // Note: We are not deep comparing config objects here for simplicity, 
      // instead relying on setModified(true) calls in setters.
      // But for content editors we check content.
      if (isHeartbeatChanged || isSoulChanged) {
        setModified(true);
      }
  }, [soulContent, heartbeatContent, goals, heartbeatView, originalHeartbeatContent, originalSoulContent]);


  if (loading) return <div className="p-8 flex justify-center"><Spinner /></div>;

  return (
    <div className="h-full overflow-y-auto no-scrollbar pb-20">
      <PageHeader 
        title="Agent Behavior" 
        subtitle="Configure how the agent lives, dreams, and evolves."
      >
        <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={loadData} disabled={saving}>
                <RotateCcw size={14} /> Revert
            </Button>
            <Button variant="primary" size="sm" onClick={handleSave} isLoading={saving} disabled={!modified && !saving}>
                <Save size={14} /> Save Changes
            </Button>
        </div>
      </PageHeader>

      <div className="px-8 space-y-6">
        
        {/* Tabs */}
        <div className="flex border-b border-border-primary">
            <button
                onClick={() => setActiveTab('lifecycles')}
                className={clsx(
                    "px-4 py-2 text-sm font-medium border-b-2 transition-colors",
                    activeTab === 'lifecycles' 
                        ? "border-accent-primary text-accent-primary" 
                        : "border-transparent text-text-secondary hover:text-text-primary"
                )}
            >
                <div className="flex items-center gap-2">
                    <Activity size={16} />
                    Life Cycles
                </div>
            </button>
            <button
                onClick={() => setActiveTab('soul')}
                className={clsx(
                    "px-4 py-2 text-sm font-medium border-b-2 transition-colors",
                    activeTab === 'soul' 
                        ? "border-accent-primary text-accent-primary" 
                        : "border-transparent text-text-secondary hover:text-text-primary"
                )}
            >
                <div className="flex items-center gap-2">
                    <Sparkles size={16} />
                    Soul
                </div>
            </button>
            <button
                onClick={() => setActiveTab('heartbeat')}
                className={clsx(
                    "px-4 py-2 text-sm font-medium border-b-2 transition-colors",
                    activeTab === 'heartbeat' 
                        ? "border-accent-primary text-accent-primary" 
                        : "border-transparent text-text-secondary hover:text-text-primary"
                )}
            >
                <div className="flex items-center gap-2">
                    <Heart size={16} />
                    Heartbeat
                </div>
            </button>
        </div>

        {/* Tab Content */}
        {activeTab === 'lifecycles' && (
             <div className="grid grid-cols-1 md:grid-cols-3 gap-6 animate-fade-in">
                {/* Heartbeat Cycle */}
                <Card className="space-y-4 flex flex-col h-full">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="p-2 rounded-lg bg-error/10 text-error">
                            <Heart size={20} />
                        </div>
                        <div>
                            <h3 className="font-semibold text-text-primary">Heartbeat</h3>
                            <Badge variant={schedules.monitor?.enabled ? "success" : "default"} size="sm">
                                {schedules.monitor?.enabled ? "Active" : "Paused"}
                            </Badge>
                        </div>
                    </div>
                    <div className="text-sm text-text-muted flex-1">
                        Monitors system health and active goals.
                    </div>
                    
                    <div className="space-y-3 pt-2 border-t border-border-secondary">
                        <div className="space-y-1">
                            <label className="text-xs font-medium text-text-secondary">Model Strategy</label>
                            <Select 
                                value={overrides['heartbeat'] || 'fast'} 
                                onChange={(val: string) => {
                                    setOverrides(prev => ({ ...prev, heartbeat: val }));
                                    setModified(true);
                                }}
                                options={MODEL_ROLES}
                            />
                        </div>
                         <div className="space-y-1">
                            <label className="text-xs font-medium text-text-secondary">Interval</label>
                            <div className="flex items-center gap-2">
                                <input 
                                    type="range" 
                                    min="5" max="60" step="5"
                                    value={schedules.monitor?.interval || 30}
                                    onChange={(e) => {
                                        setSchedules(prev => ({ ...prev, monitor: { ...prev.monitor, interval: parseInt(e.target.value) } }));
                                        setModified(true);
                                    }}
                                    className="flex-1 h-2 bg-bg-tertiary rounded-lg appearance-none cursor-pointer accent-accent-primary"
                                />
                                <span className="text-xs font-mono w-12 text-right">{schedules.monitor?.interval}m</span>
                            </div>
                        </div>
                    </div>
                </Card>

                {/* Dreamer Cycle */}
                 <Card className="space-y-4 flex flex-col h-full">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="p-2 rounded-lg bg-info/10 text-info">
                            <Moon size={20} />
                        </div>
                        <div>
                            <h3 className="font-semibold text-text-primary">Dreamer</h3>
                            <Badge variant={schedules.dreamer?.enabled ? "success" : "default"} size="sm">
                                {schedules.dreamer?.enabled ? "Active" : "Paused"}
                            </Badge>
                        </div>
                    </div>
                    <div className="text-sm text-text-muted flex-1">
                        Consolidates memories and evolves soul.
                    </div>
                    
                    <div className="space-y-3 pt-2 border-t border-border-secondary">
                        <div className="space-y-1">
                            <label className="text-xs font-medium text-text-secondary">Model Strategy</label>
                            <Select 
                                value={overrides['dreamer'] || 'thinking'} 
                                onChange={(val: string) => {
                                    setOverrides(prev => ({ ...prev, dreamer: val }));
                                    setModified(true);
                                }}
                                options={MODEL_ROLES}
                            />
                        </div>
                         <div className="space-y-1">
                            <label className="text-xs font-medium text-text-secondary">Interval</label>
                            <div className="flex items-center gap-2">
                                <input 
                                    type="range" 
                                    min="15" max="120" step="15"
                                    value={schedules.dreamer?.interval || 30}
                                    onChange={(e) => {
                                        setSchedules(prev => ({ ...prev, dreamer: { ...prev.dreamer, interval: parseInt(e.target.value) } }));
                                        setModified(true);
                                    }}
                                    className="flex-1 h-2 bg-bg-tertiary rounded-lg appearance-none cursor-pointer accent-accent-primary"
                                />
                                <span className="text-xs font-mono w-12 text-right">{schedules.dreamer?.interval}m</span>
                            </div>
                        </div>
                    </div>
                </Card>

                {/* Monologue Cycle */}
                <Card className="space-y-4 flex flex-col h-full">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="p-2 rounded-lg bg-warning/10 text-warning">
                            <MessageSquare size={20} />
                        </div>
                        <div>
                            <h3 className="font-semibold text-text-primary">Monologue</h3>
                            <Badge variant={schedules.monologue?.enabled ? "success" : "default"} size="sm">
                                {schedules.monologue?.enabled ? "Active" : "Paused"}
                            </Badge>
                        </div>
                    </div>
                    <div className="text-sm text-text-muted flex-1">
                        Internal thought processes.
                    </div>

                    <div className="space-y-3 pt-2 border-t border-border-secondary">
                        <div className="space-y-1">
                            <label className="text-xs font-medium text-text-secondary">Model Strategy</label>
                            <Select 
                                value={overrides['monologue'] || 'local'} 
                                onChange={(val: string) => {
                                    setOverrides(prev => ({ ...prev, monologue: val }));
                                    setModified(true);
                                }}
                                options={MODEL_ROLES}
                            />
                        </div>
                         <div className="space-y-1">
                            <label className="text-xs font-medium text-text-secondary">Interval</label>
                            <div className="flex items-center gap-2">
                                <input 
                                    type="range" 
                                    min="5" max="60" step="5"
                                    value={schedules.monologue?.interval || 15}
                                    onChange={(e) => {
                                        setSchedules(prev => ({ ...prev, monologue: { ...prev.monologue, interval: parseInt(e.target.value) } }));
                                        setModified(true);
                                    }}
                                    className="flex-1 h-2 bg-bg-tertiary rounded-lg appearance-none cursor-pointer accent-accent-primary"
                                />
                                <span className="text-xs font-mono w-12 text-right">{schedules.monologue?.interval}m</span>
                            </div>
                        </div>
                    </div>
                </Card>
            </div>
        )}

        {/* Soul Tab */}
        {activeTab === 'soul' && (
            <div className="space-y-6 animate-fade-in max-w-4xl">
                 <Card className="p-4 flex flex-col md:flex-row justify-between items-center gap-6">
                    <div className="flex-1">
                        <h3 className="text-base font-semibold text-text-primary">Auto-Update Personality</h3>
                        <p className="text-sm text-text-tertiary mt-1">
                            When enabled, the <strong>Dreamer</strong> will propose and automatically apply changes to <code>SOUL.md</code> based on daily experiences.
                        </p>
                    </div>
                    <div className="flex items-center gap-3">
                        <span className={soulConfig.autoUpdate ? "text-success font-bold text-sm" : "text-text-muted text-sm"}>
                            {soulConfig.autoUpdate ? "Enabled" : "Disabled"}
                        </span>
                        <button 
                            onClick={toggleSoulAutoUpdate}
                            className={`w-12 h-6 rounded-full transition-colors duration-200 flex items-center px-0.5 ${soulConfig.autoUpdate ? 'bg-success' : 'bg-bg-tertiary border border-border-primary'}`}
                        >
                            <div className={`w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${soulConfig.autoUpdate ? 'translate-x-6' : 'translate-x-0'}`} />
                        </button>
                    </div>
                </Card>

                <div className="border border-border-primary rounded-xl overflow-hidden bg-bg-secondary flex flex-col h-[500px]">
                    <div className="bg-bg-tertiary border-b border-border-primary px-4 py-3 flex items-center justify-between">
                         <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
                             <FileText size={16} className="text-accent-primary" />
                             SOUL.md
                         </div>
                    </div>
                    <textarea
                        value={soulContent}
                        onChange={(e) => { setSoulContent(e.target.value); }}
                         className="flex-1 w-full bg-transparent p-4 text-sm text-text-primary font-mono leading-relaxed resize-none focus:outline-none"
                         spellCheck={false}
                    />
                </div>
            </div>
        )}

        {/* Heartbeat Tab */}
        {activeTab === 'heartbeat' && (
            <div className="space-y-6 animate-fade-in max-w-4xl">
                 <div className="flex items-center justify-between mb-2">
                     <p className="text-sm text-text-secondary">
                         Define active goals (Heartbeat) for the agent to pursue autonomously.
                     </p>
                     <div className="flex gap-2 bg-bg-tertiary p-1 rounded-lg">
                        <button
                            onClick={() => setHeartbeatView('goals')}
                            className={clsx(
                                "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                                heartbeatView === 'goals' ? "bg-bg-secondary text-text-primary shadow-sm" : "text-text-tertiary hover:text-text-secondary"
                            )}
                        >
                            Goals View
                        </button>
                        <button
                            onClick={() => setHeartbeatView('editor')}
                            className={clsx(
                                "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                                heartbeatView === 'editor' ? "bg-bg-secondary text-text-primary shadow-sm" : "text-text-tertiary hover:text-text-secondary"
                            )}
                        >
                            Markdown View
                        </button>
                     </div>
                 </div>

                 {heartbeatView === 'goals' ? (
                      <div className="space-y-3">
                        <Button 
                            size="sm" 
                            variant="default" 
                            className="w-full justify-center border-dashed border-border-primary bg-bg-tertiary/30 hover:bg-bg-tertiary text-text-secondary"
                            onClick={() => {
                                const newGoal: Goal = {
                                    id: crypto.randomUUID(),
                                    title: 'New Goal',
                                    description: '',
                                    status: 'active',
                                    priority: 'medium',
                                };
                                setGoals([...goals, newGoal]);
                                setModified(true);
                            }}
                        >
                            <Plus size={14} /> Add Goal
                        </Button>
                        
                        {goals.length === 0 ? (
                            <EmptyState
                                icon={Target}
                                title="No goals defined"
                                description="Add a goal to get started."
                            />
                        ) : (
                            goals.map((goal, idx) => (
                                <GoalCard 
                                    key={goal.id || idx} 
                                    goal={goal} 
                                    onChange={(updated) => {
                                        setGoals(prev => prev.map(g => g.id === goal.id ? { ...g, ...updated } : g));
                                        setModified(true);
                                    }}
                                    onRemove={() => {
                                        setGoals(prev => prev.filter(g => g.id !== goal.id));
                                        setModified(true);
                                    }}
                                />
                            ))
                        )}
                      </div>
                 ) : (
                    <div className="border border-border-primary rounded-xl overflow-hidden bg-bg-secondary flex flex-col h-[500px]">
                        <div className="bg-bg-tertiary border-b border-border-primary px-4 py-3 flex items-center justify-between">
                            <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
                                <Heart size={16} className="text-error" />
                                HEARTBEAT.md
                            </div>
                        </div>
                        <textarea
                            value={heartbeatContent}
                            onChange={(e) => { setHeartbeatContent(e.target.value); }}
                            className="flex-1 w-full bg-transparent p-4 text-sm text-text-primary font-mono leading-relaxed resize-none focus:outline-none"
                            spellCheck={false}
                        />
                    </div>
                 )}
            </div>
        )}
      </div>
    </div>
  );
}

function GoalCard({
  goal,
  onChange,
  onRemove,
}: {
  goal: Goal;
  onChange: (updates: Partial<Goal>) => void;
  onRemove: () => void;
}) {
  const priorityColors = {
    high: 'text-error',
    medium: 'text-warning',
    low: 'text-accent-secondary',
  };

  return (
    <Card className="animate-fade-in group hover:border-accent-primary/20 transition-colors">
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-bg-tertiary">
          <Target className={`h-4 w-4 ${priorityColors[goal.priority]}`} />
        </div>
        <div className="flex-1 min-w-0 space-y-2">
          <input
            type="text"
            value={goal.title}
            onChange={(e) => onChange({ title: e.target.value })}
            className="w-full bg-transparent text-sm font-medium text-text-primary focus:outline-none border-b border-transparent focus:border-border-primary transition-colors placeholder:text-text-muted"
            placeholder="Goal Title"
          />
          <textarea
            value={goal.description}
            onChange={(e) => onChange({ description: e.target.value })}
            className="w-full bg-transparent text-xs text-text-secondary focus:outline-none resize-none placeholder:text-text-muted"
            rows={2}
            placeholder="Description..."
          />
          <div className="flex items-center gap-2">
            <select
              value={goal.status}
              onChange={(e) => onChange({ status: e.target.value as Goal['status'] })}
              className="rounded-md bg-bg-tertiary border border-border-primary px-2 py-1 text-[10px] text-text-primary focus:outline-none focus:border-accent-primary/50 transition-colors cursor-pointer"
            >
              <option value="active">Active</option>
              <option value="completed">Completed</option>
              <option value="paused">Paused</option>
            </select>
            <select
              value={goal.priority}
              onChange={(e) => onChange({ priority: e.target.value as Goal['priority'] })}
              className="rounded-md bg-bg-tertiary border border-border-primary px-2 py-1 text-[10px] text-text-primary focus:outline-none focus:border-accent-primary/50 transition-colors cursor-pointer"
            >
              <option value="high">High Priority</option>
              <option value="medium">Medium Priority</option>
              <option value="low">Low Priority</option>
            </select>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onRemove} className="text-text-muted hover:text-error">
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </Card>
  );
}
