'use client';

import { useState, useEffect } from 'react';
import { gatewayFetch } from '@/lib/api';
import { Card, Button, Spinner, Badge, EmptyState } from '@/components/ui';
import { Heart, Save, RotateCcw, Plus, Trash2, Target, Calendar, Clock, Timer } from 'lucide-react';

interface Goal {
  id: string;
  title: string;
  description: string;
  status: 'active' | 'completed' | 'paused';
  priority: 'high' | 'medium' | 'low';
}

export default function HeartbeatPage() {
  const [content, setContent] = useState('');
  const [original, setOriginal] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState<'editor' | 'goals' | 'schedule'>('goals');
  const [goals, setGoals] = useState<Goal[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Schedule settings state
  const [schedules, setSchedules] = useState({ heartbeat: 30, dreamer: 30, monologue: 15 });
  const [originalSchedules, setOriginalSchedules] = useState({ heartbeat: 30, dreamer: 30, monologue: 15 });
  const [savingSchedules, setSavingSchedules] = useState(false);

  useEffect(() => {
    loadHeartbeat();
    loadSchedules();
  }, []);

  const loadHeartbeat = async () => {
    try {
      setLoading(true);
      const data = await gatewayFetch<{ content: string }>('/api/heartbeat');
      setContent(data.content);
      setOriginal(data.content);
      setGoals(parseGoals(data.content));
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      const finalContent = view === 'goals' ? goalsToMarkdown(goals) : content;
      await gatewayFetch('/api/heartbeat', {
        method: 'PUT',
        body: JSON.stringify({ content: finalContent }),
      });
      setOriginal(finalContent);
      setContent(finalContent);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const addGoal = () => {
    const newGoal: Goal = {
      id: crypto.randomUUID(),
      title: 'New Goal',
      description: 'Describe this goal...',
      status: 'active',
      priority: 'medium',
    };
    setGoals([...goals, newGoal]);
  };

  const loadSchedules = async () => {
    try {
      const data = await gatewayFetch<{ heartbeat: number; dreamer: number; monologue: number }>('/api/schedules');
      setSchedules(data);
      setOriginalSchedules(data);
    } catch {
      // Silently ignore — schedules will show defaults
    }
  };

  const saveSchedules = async () => {
    try {
      setSavingSchedules(true);
      await gatewayFetch('/api/schedules', {
        method: 'PUT',
        body: JSON.stringify(schedules),
      });
      setOriginalSchedules({ ...schedules });
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSavingSchedules(false);
    }
  };

  const hasScheduleChanges =
    schedules.heartbeat !== originalSchedules.heartbeat ||
    schedules.dreamer !== originalSchedules.dreamer ||
    schedules.monologue !== originalSchedules.monologue;

  const updateGoal = (id: string, updates: Partial<Goal>) => {
    setGoals(goals.map((g) => (g.id === id ? { ...g, ...updates } : g)));
  };

  const removeGoal = (id: string) => {
    setGoals(goals.filter((g) => g.id !== id));
  };

  const hasChanges = view === 'goals'
    ? goalsToMarkdown(goals) !== original
    : view === 'schedule'
    ? hasScheduleChanges
    : content !== original;

  if (loading) {
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
            <p className="text-[11px] uppercase tracking-[0.2em] text-text-muted font-medium">Monitoring</p>
            <h1 className="text-2xl font-semibold text-text-primary tracking-tight mt-1">Heartbeat</h1>
          </div>
          <div className="flex items-center gap-2">
            {hasChanges && <Badge variant="warning">Unsaved</Badge>}
            <Button
              size="sm"
              variant={view === 'goals' ? 'primary' : 'ghost'}
              onClick={() => setView('goals')}
            >
              <Target className="h-3 w-3" />
              Goals
            </Button>
            <Button
              size="sm"
              variant={view === 'schedule' ? 'primary' : 'ghost'}
              onClick={() => setView('schedule')}
            >
              <Clock className="h-3 w-3" />
              Schedules
            </Button>
            <Button
              size="sm"
              variant={view === 'editor' ? 'primary' : 'ghost'}
              onClick={() => setView('editor')}
            >
              <Calendar className="h-3 w-3" />
              Raw
            </Button>
            <Button size="sm" variant="ghost" onClick={() => {
              if (view === 'schedule') {
                setSchedules({ ...originalSchedules });
              } else {
                loadHeartbeat();
              }
            }} disabled={!hasChanges}>
              <RotateCcw className="h-3 w-3" />
              Reset
            </Button>
            <Button size="sm" variant="primary" onClick={() => {
              if (view === 'schedule') {
                saveSchedules();
              } else {
                handleSave();
              }
            }} disabled={!hasChanges || saving || savingSchedules}>
              <Save className="h-3 w-3" />
              {saving || savingSchedules ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </div>

      {error && (
        <div className="mx-8 mb-2 rounded-lg bg-error/10 border border-error/20 px-4 py-2 text-sm text-error">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-auto px-8 pb-8">
        {view === 'goals' ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-sm font-semibold text-text-primary">Active Goals</h2>
              <Button size="sm" variant="default" onClick={addGoal}>
                <Plus className="h-3 w-3" />
                Add Goal
              </Button>
            </div>

            {goals.length === 0 ? (
              <EmptyState
                icon={Heart}
                title="No goals yet"
                description="Add goals to guide the agent's proactive behavior and self-reflection."
              />
            ) : (
              goals.map((goal) => (
                <GoalCard
                  key={goal.id}
                  goal={goal}
                  onChange={(updates) => updateGoal(goal.id, updates)}
                  onRemove={() => removeGoal(goal.id)}
                />
              ))
            )}
          </div>
        ) : view === 'schedule' ? (
          <div className="space-y-4 max-w-xl">
            <div className="mb-2">
              <h2 className="text-sm font-semibold text-text-primary">Background Schedules</h2>
              <p className="text-xs text-text-muted mt-1">
                Configure how often the agent&apos;s background processes run. Changes take effect immediately.
              </p>
            </div>

            <ScheduleInput
              icon={<Heart className="h-4 w-4 text-error" />}
              label="Heartbeat"
              description="Reads HEARTBEAT.md and acts on active goals."
              value={schedules.heartbeat}
              onChange={(v) => setSchedules({ ...schedules, heartbeat: v })}
            />

            <ScheduleInput
              icon={<Timer className="h-4 w-4 text-accent-primary" />}
              label="Dreamer"
              description="Summarizes recent conversations into long-term memory and evolution log."
              value={schedules.dreamer}
              onChange={(v) => setSchedules({ ...schedules, dreamer: v })}
            />

            <ScheduleInput
              icon={<Clock className="h-4 w-4 text-accent-secondary" />}
              label="Inner Monologue"
              description="Reflects on memories and stores autonomous insights."
              value={schedules.monologue}
              onChange={(v) => setSchedules({ ...schedules, monologue: v })}
            />
          </div>
        ) : (
          <Card className="h-full">
            <div className="flex flex-col h-full">
              <div className="flex items-center gap-2 mb-3 pb-3 border-b border-border-primary">
                <Heart className="h-4 w-4 text-error" />
                <span className="text-sm font-medium text-text-primary">HEARTBEAT.md</span>
              </div>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="flex-1 w-full bg-transparent text-sm text-text-primary font-mono leading-relaxed resize-none focus:outline-none"
                placeholder="# Heartbeat Configuration..."
                spellCheck={false}
              />
            </div>
          </Card>
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
    <Card className="animate-slide-up">
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-bg-tertiary">
          <Target className={`h-4 w-4 ${priorityColors[goal.priority]}`} />
        </div>
        <div className="flex-1 min-w-0 space-y-2">
          <input
            type="text"
            value={goal.title}
            onChange={(e) => onChange({ title: e.target.value })}
            className="w-full bg-transparent text-sm font-medium text-text-primary focus:outline-none border-b border-transparent focus:border-border-primary transition-colors"
          />
          <textarea
            value={goal.description}
            onChange={(e) => onChange({ description: e.target.value })}
            className="w-full bg-transparent text-xs text-text-tertiary focus:outline-none resize-none"
            rows={2}
          />
          <div className="flex items-center gap-2">
            <select
              value={goal.status}
              onChange={(e) => onChange({ status: e.target.value as Goal['status'] })}
              className="rounded-md bg-bg-tertiary border border-border-primary px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-accent-primary/50 transition-colors"
            >
              <option value="active">Active</option>
              <option value="completed">Completed</option>
              <option value="paused">Paused</option>
            </select>
            <select
              value={goal.priority}
              onChange={(e) => onChange({ priority: e.target.value as Goal['priority'] })}
              className="rounded-md bg-bg-tertiary border border-border-primary px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-accent-primary/50 transition-colors"
            >
              <option value="high">High Priority</option>
              <option value="medium">Medium Priority</option>
              <option value="low">Low Priority</option>
            </select>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onRemove}>
          <Trash2 className="h-3 w-3 text-text-muted" />
        </Button>
      </div>
    </Card>
  );
}

// ─── Schedule Input Card ────────────────────────────────────

const PRESET_INTERVALS = [5, 10, 15, 30, 60, 120, 360];

function ScheduleInput({
  icon,
  label,
  description,
  value,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const formatInterval = (minutes: number) => {
    if (minutes < 60) return `${minutes}m`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  };

  return (
    <Card className="animate-slide-up">
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-bg-tertiary">
          {icon}
        </div>
        <div className="flex-1 min-w-0 space-y-2">
          <div>
            <h3 className="text-sm font-medium text-text-primary">{label}</h3>
            <p className="text-xs text-text-muted">{description}</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {PRESET_INTERVALS.map((preset) => (
              <button
                key={preset}
                onClick={() => onChange(preset)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  value === preset
                    ? 'bg-accent-primary text-white'
                    : 'bg-bg-tertiary text-text-secondary hover:bg-bg-secondary border border-border-primary'
                }`}
              >
                {formatInterval(preset)}
              </button>
            ))}
            <div className="flex items-center gap-1.5 ml-1">
              <input
                type="number"
                min={1}
                max={1440}
                value={value}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (v >= 1 && v <= 1440) onChange(v);
                }}
                className="w-16 rounded-md bg-bg-tertiary border border-border-primary px-2 py-1 text-xs text-text-primary text-center focus:outline-none focus:border-accent-primary/50 transition-colors"
              />
              <span className="text-xs text-text-muted">min</span>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

// ─── Markdown ↔ Goals Helpers ─────────────────────────────────

function parseGoals(markdown: string): Goal[] {
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
}

function goalsToMarkdown(goals: Goal[]): string {
  if (goals.length === 0) return '# Heartbeat\n\nNo goals defined yet.\n';

  let md = '# Heartbeat\n\n';
  for (const goal of goals) {
    md += `## ${goal.title}\n\n`;
    if (goal.description) md += `${goal.description}\n\n`;
    md += `- **Status**: ${goal.status}\n`;
    md += `- **Priority**: ${goal.priority}\n\n`;
  }
  return md;
}
